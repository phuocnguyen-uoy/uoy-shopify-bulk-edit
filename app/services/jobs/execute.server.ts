import type { Prisma } from "@prisma/client";
import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { PRODUCT_UPDATE_MUTATION, VARIANT_UPDATE_MUTATION, COLLECTION_UPDATE_MUTATION, stageAndRunForTask } from "../bulk-edit/bulk-operations.server";
import { applyActions } from "../bulk-edit/transform";
import type { ActionDefinition, EditAction } from "../tasks/types";
import { tenantDb } from "../tenant.server";

type ProductSnapshot = {
  id: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  handle: string;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null };
  seoTitle: string | null;
  seoDescription: string | null;
};
type CollectionSnapshot = {
  id: string;
  title: string;
  descriptionHtml: string;
  handle: string;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null };
  seoTitle: string | null;
  seoDescription: string | null;
};
type VariantSnapshot = {
  id: string;
  productId: string;
  variantPrice: string;
  variantCompareAtPrice: string | null;
  variantSku: string | null;
  variantBarcode: string | null;
  variantTaxable: boolean;
  variantInventoryPolicy: string;
};

type GraphqlClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
const productFields = new Set(["title", "descriptionHtml", "vendor", "productType", "status", "tags", "handle", "templateSuffix", "seoTitle", "seoDescription"]);
const collectionFields = new Set(["title", "handle", "descriptionHtml", "templateSuffix", "seoTitle", "seoDescription"]);
const variantFields = new Map<string, string>([
  ["variantPrice", "price"],
  ["variantCompareAtPrice", "compareAtPrice"],
  ["variantSku", "sku"],
  ["variantBarcode", "barcode"],
  ["variantTaxable", "taxable"],
  ["variantInventoryPolicy", "inventoryPolicy"],
]);
const operations = new Set(["set", "clear", "find_replace", "add", "remove", "increase_fixed", "increase_percent", "decrease_fixed", "decrease_percent"]);

function parseActions(value: Prisma.JsonValue, resourceType: "PRODUCT" | "COLLECTION" | "VARIANT"): ActionDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.actions)) {
    throw new Error("Invalid task actionDefinition: actions must be an array");
  }
  const validFields = resourceType === "COLLECTION"
    ? collectionFields
    : new Set([...productFields, ...variantFields.keys()]);
  const actions = value.actions.map((raw): EditAction => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid task action");
    if (typeof raw.field !== "string" || !validFields.has(raw.field)) throw new Error(`Unsupported ${resourceType.toLowerCase()} action field`);
    if (typeof raw.operation !== "string" || !operations.has(raw.operation)) throw new Error("Unsupported action operation");
    return raw as unknown as EditAction;
  });
  if (actions.length === 0) throw new Error("Task has no actions");
  if (resourceType !== "COLLECTION") {
    const scopes = new Set(actions.map((action) => variantFields.has(action.field) ? "VARIANT" : "PRODUCT"));
    if (scopes.size !== 1) throw new Error("A task cannot mix product and variant action fields");
  }
  return { actions };
}

function parseFrozenIds(value: Prisma.JsonValue | null, resourceType: "PRODUCT" | "COLLECTION"): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Task has no frozen preview resources");
  const prefix = resourceType === "COLLECTION" ? "gid://shopify/Collection/" : "gid://shopify/Product/";
  if (value.length > 250 || value.some((id) => typeof id !== "string" || !id.startsWith(prefix))) {
    throw new Error(`Task frozenResourceIds are invalid or exceed the 250-${resourceType.toLowerCase()} MVP limit`);
  }
  return [...new Set(value as string[])];
}

async function snapshotBatch(admin: GraphqlClient, ids: string[], retry = true): Promise<ProductSnapshot[]> {
  const response = await admin.graphql(`#graphql
    query ProductSnapshots($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id title descriptionHtml vendor productType status tags handle templateSuffix seo { title description } }
      }
    }
  `, { variables: { ids } });
  if (response.status === 429 && retry) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return snapshotBatch(admin, ids, false);
  }
  const body = await response.json() as {
    data?: { nodes?: Array<ProductSnapshot | null> };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const throttled = body.errors?.some((error) => error.extensions?.code === "THROTTLED");
  if (throttled && retry) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return snapshotBatch(admin, ids, false);
  }
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((error) => error.message).join("; ") || `Snapshot HTTP ${response.status}`);
  const products = body.data?.nodes?.filter((node): node is ProductSnapshot => Boolean(node)).map((product) => ({
    ...product,
    seoTitle: product.seo?.title ?? null,
    seoDescription: product.seo?.description ?? null,
  })) ?? [];
  if (products.length !== ids.length) throw new Error("One or more frozen products no longer exist");
  return products;
}

async function snapshotVariantsForProducts(admin: GraphqlClient, productIds: string[]): Promise<VariantSnapshot[]> {
  const response = await admin.graphql(`#graphql
    query VariantSnapshots($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 250) {
            nodes { id price compareAtPrice sku barcode taxable inventoryPolicy }
            pageInfo { hasNextPage }
          }
        }
      }
    }
  `, { variables: { ids: productIds } });
  const body = await response.json() as {
    data?: { nodes?: Array<{
      id: string;
      variants: {
        nodes: Array<{ id: string; price: string; compareAtPrice: string | null; sku: string | null; barcode: string | null; taxable: boolean; inventoryPolicy: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    } | null> };
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((error) => error.message).join("; ") || `Variant snapshot HTTP ${response.status}`);
  const products = body.data?.nodes?.filter((node): node is NonNullable<typeof node> => Boolean(node)) ?? [];
  if (products.length !== productIds.length) throw new Error("One or more frozen products no longer exist");
  if (products.some((product) => product.variants.pageInfo.hasNextPage)) throw new Error("A matched product exceeds the 250-variant safety limit");
  return products.flatMap((product) => product.variants.nodes.map((variant) => ({
    id: variant.id,
    productId: product.id,
    variantPrice: variant.price,
    variantCompareAtPrice: variant.compareAtPrice,
    variantSku: variant.sku,
    variantBarcode: variant.barcode,
    variantTaxable: variant.taxable,
    variantInventoryPolicy: variant.inventoryPolicy,
  })));
}

async function snapshotVariantsByIds(admin: GraphqlClient, ids: string[]): Promise<VariantSnapshot[]> {
  const response = await admin.graphql(`#graphql
    query VariantSnapshotsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant { id price compareAtPrice sku barcode taxable inventoryPolicy product { id } }
      }
    }
  `, { variables: { ids } });
  const body = await response.json() as {
    data?: { nodes?: Array<{
      id: string; price: string; compareAtPrice: string | null; sku: string | null; barcode: string | null;
      taxable: boolean; inventoryPolicy: string; product: { id: string };
    } | null> };
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((error) => error.message).join("; ") || `Variant snapshot HTTP ${response.status}`);
  const variants = body.data?.nodes?.filter((node): node is NonNullable<typeof node> => Boolean(node)).map((variant) => ({
    id: variant.id,
    productId: variant.product.id,
    variantPrice: variant.price,
    variantCompareAtPrice: variant.compareAtPrice,
    variantSku: variant.sku,
    variantBarcode: variant.barcode,
    variantTaxable: variant.taxable,
    variantInventoryPolicy: variant.inventoryPolicy,
  })) ?? [];
  if (variants.length !== ids.length) throw new Error("One or more rollback variants no longer exist");
  return variants;
}

async function snapshotCollectionBatch(admin: GraphqlClient, ids: string[], retry = true): Promise<CollectionSnapshot[]> {
  const response = await admin.graphql(`#graphql
    query CollectionSnapshots($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Collection { id title descriptionHtml handle templateSuffix seo { title description } }
      }
    }
  `, { variables: { ids } });
  if (response.status === 429 && retry) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return snapshotCollectionBatch(admin, ids, false);
  }
  const body = await response.json() as {
    data?: { nodes?: Array<Omit<CollectionSnapshot, "seoTitle" | "seoDescription"> | null> };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const throttled = body.errors?.some((error) => error.extensions?.code === "THROTTLED");
  if (throttled && retry) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return snapshotCollectionBatch(admin, ids, false);
  }
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((error) => error.message).join("; ") || `Snapshot HTTP ${response.status}`);
  const collections = body.data?.nodes?.filter((node): node is NonNullable<typeof node> => Boolean(node)).map((collection) => ({
    ...collection,
    seoTitle: collection.seo?.title ?? null,
    seoDescription: collection.seo?.description ?? null,
  })) ?? [];
  if (collections.length !== ids.length) throw new Error("One or more frozen collections no longer exist");
  return collections;
}

function collectionInput(id: string, flat: Prisma.InputJsonObject) {
  const input: Record<string, unknown> = { id };
  const seo: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(flat)) {
    if (field === "seoTitle") seo.title = value;
    else if (field === "seoDescription") seo.description = value;
    else input[field] = value;
  }
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

function variantInput(id: string, flat: Prisma.InputJsonObject) {
  const input: Record<string, unknown> = { id };
  for (const [field, value] of Object.entries(flat)) {
    const apiField = variantFields.get(field);
    if (!apiField) throw new Error("Unsupported variant action field: " + field);
    input[apiField] = field === "variantTaxable" ? value === true || value === "true" : value;
  }
  return input;
}

function variantRows(variants: Array<{ productId: string; input: Record<string, unknown> }>) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const variant of variants) {
    const inputs = grouped.get(variant.productId) ?? [];
    inputs.push(variant.input);
    grouped.set(variant.productId, inputs);
  }
  return [...grouped].map(([productId, variants]) => ({ productId, variants }));
}

function pick(snapshot: Record<string, unknown>, fields: Set<string>): Prisma.InputJsonObject {
  return Object.fromEntries([...fields].map((field) => [field, snapshot[field] as Prisma.InputJsonValue]));
}

function productInput(id: string, flat: Prisma.InputJsonObject) {
  const input: Record<string, unknown> = { id };
  const seo: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(flat)) {
    if (field === "seoTitle") seo.title = value;
    else if (field === "seoDescription") seo.description = value;
    else input[field] = value;
  }
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

function parseSnapshot(value: Prisma.JsonValue, label: string): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid " + label + " snapshot");
  return value as Prisma.InputJsonObject;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).sort().join(",") + "]";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(object[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function executeRollback(
  admin: GraphqlClient,
  shopDomain: string,
  runId: string,
  sourceRunId: string,
) {
  const scoped = tenantDb(db, shopDomain);
  const sourceChanges = await scoped.taskChange.findForRun(sourceRunId);
  if (sourceChanges.length === 0) throw new Error("Source run has no rollback snapshots");
  if (sourceChanges.length > 250) throw new Error("Rollback exceeds the 250-resource MVP limit");
  const resourceTypes = new Set(sourceChanges.map((change) => change.resourceType));
  if (resourceTypes.size !== 1) throw new Error("Rollback source mixes resource types");

  if (resourceTypes.has("VARIANT")) {
    const variants = await snapshotVariantsByIds(admin, sourceChanges.map((change) => change.resourceGid));
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const reverseChanges = sourceChanges.map((change) => {
      const before = parseSnapshot(change.before, "before");
      const expected = parseSnapshot(change.after, "after");
      const current = byId.get(change.resourceGid);
      if (!current) throw new Error("Rollback variant no longer exists: " + change.resourceGid);
      const fields = new Set(Object.keys(expected));
      const actual = pick(current, fields);
      if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("Rollback conflict detected for " + change.resourceGid);
      return {
        runId,
        resourceGid: change.resourceGid,
        resourceType: "VARIANT" as const,
        before: actual,
        after: before,
        productId: current.productId,
        input: variantInput(change.resourceGid, before),
      };
    });
    await scoped.taskChange.createMany(reverseChanges.map(({ productId: _productId, input: _input, ...change }) => change));
    return stageAndRunForTask(
      admin,
      scoped.shopDomain,
      runId,
      VARIANT_UPDATE_MUTATION,
      variantRows(reverseChanges.map((change) => ({ productId: change.productId, input: change.input }))),
    );
  }

  if (resourceTypes.has("COLLECTION")) {
    const collections = await snapshotCollectionBatch(admin, sourceChanges.map((change) => change.resourceGid));
    const byId = new Map(collections.map((collection) => [collection.id, collection]));
    const rows: Record<string, unknown>[] = [];
    const reverseChanges = sourceChanges.map((change) => {
      const before = parseSnapshot(change.before, "before");
      const expected = parseSnapshot(change.after, "after");
      const current = byId.get(change.resourceGid);
      if (!current) throw new Error("Rollback collection no longer exists: " + change.resourceGid);
      const fields = new Set(Object.keys(expected));
      const actual = pick(current, fields);
      if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("Rollback conflict detected for " + change.resourceGid);
      rows.push({ input: collectionInput(change.resourceGid, before) });
      return {
        runId,
        resourceGid: change.resourceGid,
        resourceType: "COLLECTION" as const,
        before: actual,
        after: before,
      };
    });
    await scoped.taskChange.createMany(reverseChanges);
    return stageAndRunForTask(admin, scoped.shopDomain, runId, COLLECTION_UPDATE_MUTATION, rows);
  }

  const products = await snapshotBatch(admin, sourceChanges.map((change) => change.resourceGid));
  const byId = new Map(products.map((product) => [product.id, product]));
  const rows: Record<string, unknown>[] = [];
  const reverseChanges = sourceChanges.map((change) => {
    const before = parseSnapshot(change.before, "before");
    const expected = parseSnapshot(change.after, "after");
    const current = byId.get(change.resourceGid);
    if (!current) throw new Error("Rollback product no longer exists: " + change.resourceGid);
    const fields = new Set(Object.keys(expected));
    const actual = pick(current, fields);
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("Rollback conflict detected for " + change.resourceGid);
    rows.push({ input: productInput(change.resourceGid, before) });
    return {
      runId,
      resourceGid: change.resourceGid,
      resourceType: "PRODUCT" as const,
      before: actual,
      after: before,
    };
  });
  await scoped.taskChange.createMany(reverseChanges);
  return stageAndRunForTask(admin, scoped.shopDomain, runId, PRODUCT_UPDATE_MUTATION, rows);
}

export async function executeRun(shopDomain: string, runId: string) {
  const scoped = tenantDb(db, shopDomain);
  const claimed = await scoped.taskRun.claimForExecution(runId);
  if (claimed.count !== 1) return null;

  try {
    const run = await scoped.taskRun.findForExecution(runId);
    if (!run) throw new Error("Claimed run not found");
    const { admin } = await unauthenticated.admin(scoped.shopDomain);
    if (run.kind === "REVERT") {
      if (!run.sourceRunId) throw new Error("Rollback run is missing sourceRunId");
      return executeRollback(admin, scoped.shopDomain, run.id, run.sourceRunId);
    }
    const resourceType = run.task.resourceType as "PRODUCT" | "COLLECTION";
    if (!["PRODUCT", "COLLECTION"].includes(resourceType) || run.task.selectionMode !== "FROZEN") {
      throw new Error("MVP executor supports PRODUCT and COLLECTION FROZEN tasks only");
    }
    const actions = parseActions(run.task.actionDefinition, resourceType);
    const ids = parseFrozenIds(run.task.frozenResourceIds, resourceType);
    const fields = new Set(actions.actions.map((action) => action.field));

    if (resourceType === "COLLECTION") {
      const collections = await snapshotCollectionBatch(admin, ids);
      const changes = collections.map((collection) => {
        const after = applyActions("COLLECTION", collection, actions.actions);
        return {
          shopDomain: scoped.shopDomain,
          runId,
          resourceGid: collection.id,
          resourceType: "COLLECTION" as const,
          before: pick(collection, fields),
          after: pick(after, fields),
          input: collectionInput(collection.id, pick(after, fields)),
        };
      }).filter((change) => canonicalJson(change.before) !== canonicalJson(change.after));
      if (changes.length === 0) {
        await scoped.taskRun.completeWithoutOperation(runId);
        return null;
      }
      await scoped.taskChange.createMany(changes.map(({ input: _input, ...change }) => change));
      return stageAndRunForTask(admin, scoped.shopDomain, runId, COLLECTION_UPDATE_MUTATION, changes.map((change) => ({ input: change.input })));
    }

    const variantScope = actions.actions.every((action) => variantFields.has(action.field));

    if (variantScope) {
      const variants = await snapshotVariantsForProducts(admin, ids);
      if (variants.length === 0) throw new Error("Matched products have no variants");
      if (variants.length > 250) throw new Error("Variant edit exceeds the 250-variant MVP limit");
      const changes = variants.map((variant) => {
        const after = applyActions("PRODUCT", variant, actions.actions);
        return {
          shopDomain: scoped.shopDomain,
          runId,
          resourceGid: variant.id,
          resourceType: "VARIANT" as const,
          before: pick(variant, fields),
          after: pick(after, fields),
          productId: variant.productId,
          input: variantInput(variant.id, pick(after, fields)),
        };
      }).filter((change) => canonicalJson(change.before) !== canonicalJson(change.after));
      if (changes.length === 0) {
        await scoped.taskRun.completeWithoutOperation(runId);
        return null;
      }
      await scoped.taskChange.createMany(changes.map(({ productId: _productId, input: _input, ...change }) => change));
      return stageAndRunForTask(
        admin,
        scoped.shopDomain,
        runId,
        VARIANT_UPDATE_MUTATION,
        variantRows(changes.map((change) => ({ productId: change.productId, input: change.input }))),
      );
    }

    const products = await snapshotBatch(admin, ids);
    const changes = products.map((product) => {
      const after = applyActions("PRODUCT", product, actions.actions);
      return {
        shopDomain: scoped.shopDomain,
        runId,
        resourceGid: product.id,
        resourceType: "PRODUCT" as const,
        before: pick(product, fields),
        after: pick(after, fields),
        input: productInput(product.id, pick(after, fields)),
      };
    }).filter((change) => canonicalJson(change.before) !== canonicalJson(change.after));
    if (changes.length === 0) {
      await scoped.taskRun.completeWithoutOperation(runId);
      return null;
    }
    await scoped.taskChange.createMany(changes.map(({ input: _input, ...change }) => change));
    return stageAndRunForTask(admin, scoped.shopDomain, runId, PRODUCT_UPDATE_MUTATION, changes.map((change) => ({ input: change.input })));
  } catch (error) {
    await scoped.taskRun.failPreparation(runId, { message: error instanceof Error ? error.message : "Unknown executor error" });
    throw error;
  }
}

// Privileged scan of queued identifiers only; executeRun scopes all reads/writes by shop.
export async function executeQueuedRuns(limit = 10) {
  const runs = await db.taskRun.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, shopDomain: true },
  });
  return Promise.allSettled(runs.map((run) => executeRun(run.shopDomain, run.id)));
}
