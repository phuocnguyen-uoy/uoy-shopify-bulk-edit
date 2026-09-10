import type { ResourceType } from "@prisma/client";
import type { FilterCondition, FilterDefinition } from "../tasks/types";

type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type TargetCandidate = {
  id: string;
  title?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  status?: string;
  handle?: string;
  tags?: string[];
  totalInventory?: number;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  hasOnlyDefaultVariant?: boolean;
  isGiftCard?: boolean;
  requiresSellingPlan?: boolean;
  collections?: { nodes: Array<{ id: string }> };
  variants?: {
    nodes: Array<{
      title?: string | null;
      sku?: string | null;
      barcode?: string | null;
      price?: string;
      taxable?: boolean;
      inventoryQuantity?: number;
    }>;
  };
};

export type VariantCandidate = {
  id: string;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string;
  compareAtPrice?: string | null;
  taxable?: boolean;
  inventoryPolicy?: string;
  inventoryQuantity?: number;
  product?: {
    id: string;
    title?: string;
    vendor?: string;
    productType?: string;
    status?: string;
    tags?: string[];
    handle?: string;
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: string | null;
    totalInventory?: number;
    hasOnlyDefaultVariant?: boolean;
    isGiftCard?: boolean;
    requiresSellingPlan?: boolean;
    collections?: { nodes: Array<{ id: string }> };
  };
};

function valuesFor(node: TargetCandidate, field: string): unknown[] {
  if (
    field === "sku" ||
    field === "barcode" ||
    field === "price" ||
    field === "variantTaxable" ||
    field === "variantTitle"
  ) {
    const key =
      field === "variantTaxable" ? "taxable" : field === "variantTitle" ? "title" : field;
    const values =
      node.variants?.nodes.map(
        (variant) => variant[key as keyof typeof variant],
      ) ?? [];
    return values.length ? values : [undefined];
  }
  if (field === "tags") return node.tags?.length ? node.tags : [undefined];
  if (field === "variantsCount") return [node.variants?.nodes.length ?? 0];
  if (field === "publishedStatus")
    return [node.publishedAt ? "published" : "unpublished"];
  if (field === "collectionId")
    return (
      node.collections?.nodes.map((collection) => collection.id) ?? [undefined]
    );
  if (field === "hasOutOfStockVariants") {
    return [
      node.variants?.nodes.some(
        (variant) => (variant.inventoryQuantity ?? 0) <= 0,
      ) ?? false,
    ];
  }
  if (field in node) return [node[field as keyof TargetCandidate]];
  throw new Error(`Target discovery cannot evaluate field: ${field}`);
}

function comparable(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  return text.startsWith("gid://shopify/")
    ? text.slice(text.lastIndexOf("/") + 1)
    : text;
}

function compare(value: unknown, condition: FilterCondition) {
  const actual = comparable(value);
  const expected = comparable(condition.value);
  const list = (
    condition.values ??
    (typeof condition.value === "string" ? condition.value.split(",") : [])
  ).map((item) => comparable(item.trim()));
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const upperNumber = Number(condition.valueTo);
  const numeric =
    Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);
  switch (condition.operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "not_contains":
      return !actual.includes(expected);
    case "starts_with":
      return actual.startsWith(expected);
    case "ends_with":
      return actual.endsWith(expected);
    case "in_list":
      return list.includes(actual);
    case "not_in_list":
      return !list.includes(actual);
    case "is_empty":
      return value === null || value === undefined || actual === "";
    case "is_not_empty":
      return !(value === null || value === undefined || actual === "");
    case "greater_than":
      return numeric ? actualNumber > expectedNumber : actual > expected;
    case "after":
      return actual > expected;
    case "less_than":
      return numeric ? actualNumber < expectedNumber : actual < expected;
    case "before":
      return actual < expected;
    case "between":
      return numeric && Number.isFinite(upperNumber)
        ? actualNumber >= expectedNumber && actualNumber <= upperNumber
        : actual >= expected && actual <= comparable(condition.valueTo);
  }
}

function valuesForVariant(node: VariantCandidate, field: string): unknown[] {
  const product = node.product;
  switch (field) {
    case "productTitle": return [product?.title];
    case "productVendor": return [product?.vendor];
    case "productType": return [product?.productType];
    case "productStatus": return [product?.status];
    case "productHandle": return [product?.handle];
    case "productTags": return product?.tags?.length ? product.tags : [undefined];
    case "productCreatedAt": return [product?.createdAt];
    case "productUpdatedAt": return [product?.updatedAt];
    case "productPublishedAt": return [product?.publishedAt];
    case "productPublishedStatus": return [product?.publishedAt ? "published" : "unpublished"];
    case "productTotalInventory": return [product?.totalInventory];
    case "productHasOnlyDefaultVariant": return [product?.hasOnlyDefaultVariant];
    case "productIsGiftCard": return [product?.isGiftCard];
    case "productRequiresSellingPlan": return [product?.requiresSellingPlan];
    case "productCollectionId":
      return product?.collections?.nodes.map((c) => c.id) ?? [undefined];
  }
  if (field in node) return [node[field as keyof VariantCandidate]];
  throw new Error(`Target discovery cannot evaluate variant field: ${field}`);
}

export function matchesVariantTarget(
  node: VariantCandidate,
  filter: FilterDefinition,
) {
  const results = filter.conditions.map((condition) => {
    const perValue = valuesForVariant(node, condition.field).map((value) =>
      compare(value, condition),
    );
    return condition.operator.startsWith("not_")
      ? perValue.every(Boolean)
      : perValue.some(Boolean);
  });
  return filter.combinator === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

export function matchesTarget(node: TargetCandidate, filter: FilterDefinition) {
  const results = filter.conditions.map((condition) => {
    const perValue = valuesFor(node, condition.field).map((value) =>
      compare(value, condition),
    );
    return condition.operator.startsWith("not_")
      ? perValue.every(Boolean)
      : perValue.some(Boolean);
  });
  return filter.combinator === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

async function page(
  admin: GraphqlClient,
  resourceType: ResourceType,
  query: string,
  after: string | null,
) {
  const root = resourceType === "COLLECTION" ? "collections" : "products";
  const selection =
    resourceType === "COLLECTION"
      ? "id title descriptionHtml handle"
      : `id title descriptionHtml vendor productType status handle tags totalInventory createdAt updatedAt publishedAt
       hasOnlyDefaultVariant isGiftCard requiresSellingPlan
       collections(first: 250) { nodes { id } }
       variants(first: 250) { nodes { title sku barcode price taxable inventoryQuantity } }`;
  const response = await admin.graphql(
    `query DiscoverTargets($query: String!, $after: String) {
      ${root}(first: 250, after: $after, query: $query) {
        nodes { ${selection} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { variables: { query, after } },
  );
  const body = (await response.json()) as {
    data?: Record<
      string,
      {
        nodes: TargetCandidate[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      }
    >;
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.length) {
    throw new Error(
      body.errors?.map((error) => error.message).join("; ") ||
        `Target discovery HTTP ${response.status}`,
    );
  }
  const result = body.data?.[root];
  if (!result)
    throw new Error("Shopify returned incomplete target discovery data");
  return result;
}

async function pageVariants(
  admin: GraphqlClient,
  query: string,
  after: string | null,
) {
  const response = await admin.graphql(
    `query DiscoverVariants($query: String!, $after: String) {
      productVariants(first: 250, after: $after, query: $query) {
        nodes {
          id title sku barcode price compareAtPrice taxable
          inventoryPolicy inventoryQuantity
          product {
            id title vendor productType status tags handle
            createdAt updatedAt publishedAt totalInventory
            hasOnlyDefaultVariant isGiftCard requiresSellingPlan
            collections(first: 250) { nodes { id } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { variables: { query, after } },
  );
  const body = (await response.json()) as {
    data?: {
      productVariants: {
        nodes: VariantCandidate[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.length) {
    throw new Error(
      body.errors?.map((e) => e.message).join("; ") ||
        `Variant discovery HTTP ${response.status}`,
    );
  }
  const result = body.data?.productVariants;
  if (!result)
    throw new Error("Shopify returned incomplete variant discovery data");
  return result;
}

export async function discoverTargetIds(
  admin: GraphqlClient,
  resourceType: ResourceType,
  query: string,
  filter: FilterDefinition,
  maxTargets = 50_000,
) {
  const ids: string[] = [];
  let after: string | null = null;

  if (resourceType === "VARIANT") {
    do {
      const result = await pageVariants(admin, query, after);
      for (const node of result.nodes) {
        if (matchesVariantTarget(node, filter)) {
          ids.push(node.id);
          if (ids.length > maxTargets) {
            throw new Error(
              `Task exceeds the ${maxTargets.toLocaleString()} target safety limit`,
            );
          }
        }
      }
      after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
      if (result.pageInfo.hasNextPage && !after) {
        throw new Error("Shopify variant discovery cursor is missing");
      }
    } while (after);
    return ids;
  }

  do {
    const result = await page(admin, resourceType, query, after);
    for (const node of result.nodes) {
      if (matchesTarget(node, filter)) {
        ids.push(node.id);
        if (ids.length > maxTargets) {
          throw new Error(
            `Task exceeds the ${maxTargets.toLocaleString()} target safety limit`,
          );
        }
      }
    }
    after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
    if (result.pageInfo.hasNextPage && !after) {
      throw new Error("Shopify target discovery cursor is missing");
    }
  } while (after);
  return ids;
}
