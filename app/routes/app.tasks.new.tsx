import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSubmit,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import type { ResourceType } from "@prisma/client";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { DatePicker } from "../components/DatePicker";

import { compileProductSearch } from "../services/bulk-edit/filter-compiler";
import { executeRun } from "../services/jobs/execute.server";
import { requireField } from "../services/bulk-edit/field-registry";
import {
  createDraftTask,
  enqueueTaskNow,
  getTask,
} from "../services/tasks/task-service.server";
import type {
  EditAction,
  FilterDefinition,
  FilterCondition,
  FilterOperator,
} from "../services/tasks/types";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const copyFrom = new URL(request.url).searchParams.get("copyFrom");
  if (!copyFrom) return { prefill: null };
  const task = await getTask(session.shop, copyFrom);
  const filters = task.filterDefinition as unknown as FilterDefinition;
  const actions = task.actionDefinition as unknown as { actions: EditAction[] };
  return {
    prefill: {
      name: `${task.name} (Edited copy)`,
      resourceType: task.resourceType,
      filter: filters.conditions[0] ?? null,
      action: actions.actions[0] ?? null,
    },
  };
};

const VALUE_REQUIRED_OPERATORS = new Set<FilterOperator>([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
]);

function readConfiguration(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) throw new Response("Task name is required", { status: 422 });
  const resourceType = String(
    form.get("resourceType") ?? "PRODUCT",
  ) as ResourceType;
  if (resourceType !== "PRODUCT") {
    throw new Response("Unsupported resource type", { status: 422 });
  }
  const field = String(form.get("filterField") ?? "").trim();
  const operator = String(form.get("filterOperator") ?? "") as FilterOperator;
  const value = String(form.get("filterValue") ?? "").trim();
  const actionField = String(form.get("actionField") ?? "").trim();
  const operation = String(
    form.get("operation") ?? "set",
  ) as EditAction["operation"];
  const actionValue = String(form.get("actionValue") ?? "");
  const find = String(form.get("find") ?? "");
  const replace = String(form.get("replace") ?? "");
  const validOps = new Set([
    "set", "clear", "find_replace", "add", "remove",
    "increase_fixed", "decrease_fixed", "increase_percent", "decrease_percent",
  ]);
  if (!validOps.has(operation))
    throw new Response("Unsupported edit operation", { status: 422 });

  if (VALUE_REQUIRED_OPERATORS.has(operator) && !value) {
    throw new Response("Filter value is required for the selected operator", {
      status: 422,
    });
  }

  requireField(resourceType, field);
  const actionDefinition = requireField(resourceType, actionField);
  if (!actionDefinition.editable)
    throw new Response("Action field is read-only", { status: 422 });

  const filters: FilterDefinition = {
    combinator: "and",
    conditions: [
      { field, operator, ...(operator.startsWith("is_") ? {} : { value }) },
    ],
  };
  if (operation === "find_replace" && !find) {
    throw new Response("Find value is required", { status: 422 });
  }
  const action: EditAction =
    operation === "find_replace"
      ? { field: actionField, operation, find, replace }
      : { field: actionField, operation, value: actionValue };
  const actions = { actions: [action] };
  return { name, resourceType, filters, actions };
}

// Fields that can be post-filtered server-side for true substring matching.
// Shopify doesn't support leading wildcards, so "contains" must be verified after fetch.
const SUBSTRING_FILTER_FIELDS: Record<string, string> = {
  title: "title",
  vendor: "vendor",
  productType: "productType",
  handle: "handle",
  tags: "tags",
  sku: "sku",
  barcode: "barcode",
};

type PreviewNode = {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  handle: string;
  tags: string[];
  variants: { nodes: Array<{ sku: string | null; barcode: string | null }> };
};

function applyContainsPostFilter(
  nodes: PreviewNode[],
  conditions: FilterCondition[],
) {
  const substringConds = conditions.filter(
    (c) =>
      (c.operator === "contains" || c.operator === "not_contains") &&
      c.field in SUBSTRING_FILTER_FIELDS,
  );
  if (substringConds.length === 0) return nodes;
  return nodes.filter((node) =>
    substringConds.every((cond) => {
      const searchVal = String(cond.value ?? "").toLowerCase();
      const values =
        cond.field === "sku" || cond.field === "barcode"
          ? node.variants.nodes.map((variant) => variant[cond.field as "sku" | "barcode"] ?? "")
          : cond.field === "tags"
            ? node.tags
            : [String(node[SUBSTRING_FILTER_FIELDS[cond.field] as keyof PreviewNode] ?? "")];
      const matches = values.some((value) =>
        String(value).toLowerCase().includes(searchVal),
      );
      return cond.operator === "contains" ? matches : !matches;
    }),
  );
}

async function affectedCount(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  resourceType: ResourceType,
  query: string,
  filterConditions: FilterCondition[],
) {
  const response = await admin.graphql(
    `#graphql
    query PreviewAffectedProducts($query: String!) {
      productsCount(query: $query) { count precision }
      products(first: 250, query: $query) {
        nodes {
          id title vendor productType handle tags
          variants(first: 250) { nodes { sku barcode } }
        }
        pageInfo { hasNextPage }
      }
    }
  `,
    { variables: { query } },
  );
  if (!response.ok)
    throw new Response("Shopify preview request failed", { status: 502 });
  const body = (await response.json()) as {
    data?: {
      productsCount?: { count: number; precision: string };
      products?: {
        nodes: PreviewNode[];
        pageInfo: { hasNextPage: boolean };
      };
    };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length)
    throw new Response(body.errors.map((e) => e.message).join("; "), {
      status: 422,
    });
  const result = body.data?.productsCount;
  const products = body.data?.products;
  if (!result || !products)
    throw new Response("Shopify returned incomplete preview data", {
      status: 502,
    });
  if (products.pageInfo.hasNextPage || result.count > 250) {
    throw new Response("MVP supports at most 250 products per frozen task", {
      status: 422,
    });
  }
  const matched = applyContainsPostFilter(products.nodes, filterConditions);
  if (matched.length === 0)
    throw new Response("No products match this filter", { status: 422 });
  return {
    count: matched.length,
    precision: matched.length === result.count ? result.precision : "EXACT",
    resourceIds: matched.map((p) => p.id),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    const configuration = readConfiguration(form);
    const query = compileProductSearch(
      configuration.resourceType,
      configuration.filters,
    );

    if (intent === "create" || intent === "run") {
      const rawIds = String(form.get("frozenIds") ?? "").trim();
      const frozenResourceIds = rawIds
        ? rawIds.split(",").filter(Boolean)
        : (await affectedCount(admin, configuration.resourceType, query, configuration.filters.conditions))
            .resourceIds;

      const task = await createDraftTask(session.shop, {
        ...configuration,
        frozenResourceIds,
      });
      if (intent === "run") {
        const run = await enqueueTaskNow(session.shop, task.id);
        await executeRun(session.shop, run.id);
      }
      return redirect(`/app/tasks/${task.id}`);
    }

    const preview = await affectedCount(
      admin,
      configuration.resourceType,
      query,
      configuration.filters.conditions,
    );
    return { preview, query };
  } catch (e) {
    if (e instanceof Response) {
      const message = await e.text();
      return { error: message };
    }
    throw e;
  }
};

// ── Client-side field metadata ────────────────────────────────────────────────

type UiKind = "string" | "string_list" | "number" | "date" | "status" | "boolean";

const PRODUCT_FILTER_FIELDS: { value: string; label: string; kind: UiKind }[] =
  [
    // Product fields
    { value: "title",                 label: "Product title",               kind: "string" },
    { value: "vendor",                label: "Product vendor",              kind: "string" },
    { value: "productType",           label: "Product type",                kind: "string" },
    { value: "status",                label: "Product status",              kind: "status" },
    { value: "tags",                  label: "Product tags",                kind: "string_list" },
    { value: "handle",                label: "Product URL handle",          kind: "string" },
    { value: "collectionId",          label: "Product collection",          kind: "string" },
    { value: "totalInventory",        label: "Product total inventory",     kind: "number" },
    { value: "variantsCount",         label: "Product variants count",      kind: "number" },
    { value: "publishedAt",           label: "Product published at",        kind: "date" },
    { value: "createdAt",             label: "Product created at",          kind: "date" },
    { value: "updatedAt",             label: "Product updated at",          kind: "date" },
    { value: "publishedStatus",       label: "Product published status",    kind: "status" },
    { value: "hasOnlyDefaultVariant", label: "Has only default variant",    kind: "boolean" },
    { value: "isGiftCard",            label: "Is gift card",                kind: "boolean" },
    { value: "hasOutOfStockVariants", label: "Has out-of-stock variants",   kind: "boolean" },
    { value: "requiresSellingPlan",   label: "Requires subscription",       kind: "boolean" },
    { value: "variantTaxable",        label: "Variant is taxable",           kind: "boolean" },
    // Variant fields (filterable via Shopify product search)
    { value: "sku",                   label: "Variant SKU",                 kind: "string" },
    { value: "barcode",               label: "Variant barcode",             kind: "string" },
    { value: "price",                 label: "Variant price",               kind: "number" },
  ];

const PRODUCT_ACTION_FIELDS: { value: string; label: string; kind: UiKind }[] =
  [
    { value: "title",           label: "Title",                kind: "string" },
    { value: "descriptionHtml", label: "Description (HTML)",  kind: "string" },
    { value: "vendor",          label: "Vendor",               kind: "string" },
    { value: "productType",     label: "Product type",         kind: "string" },
    { value: "status",          label: "Status",               kind: "status" },
    { value: "tags",            label: "Tags",                 kind: "string_list" },
    { value: "handle",          label: "URL handle",           kind: "string" },
    { value: "seoTitle",        label: "SEO page title",       kind: "string" },
    { value: "seoDescription",  label: "SEO meta description", kind: "string" },
    { value: "templateSuffix",  label: "Product · Theme template suffix", kind: "string" },
    { value: "variantPrice",          label: "Variant · Price", kind: "number" },
    { value: "variantCompareAtPrice", label: "Variant · Compare-at price", kind: "number" },
    { value: "variantSku",            label: "Variant · SKU", kind: "string" },
    { value: "variantBarcode",        label: "Variant · Barcode", kind: "string" },
    { value: "variantTaxable",        label: "Variant · Is taxable", kind: "boolean" },
    { value: "variantWeight",         label: "Variant · Weight", kind: "number" },
    { value: "variantWeightUnit",     label: "Variant · Weight unit", kind: "status" },
    { value: "variantRequiresShipping", label: "Variant · Requires shipping", kind: "boolean" },
    { value: "variantInventoryPolicy", label: "Variant · Out-of-stock policy", kind: "status" },
    { value: "variantCostPerItem",    label: "Variant · Cost per item", kind: "number" },
  ];

const VARIANT_FILTER_FIELDS: { value: string; label: string; kind: UiKind }[] = [
  { value: "title", label: "Variant title", kind: "string" },
  { value: "sku", label: "Variant SKU", kind: "string" },
  { value: "barcode", label: "Variant barcode", kind: "string" },
  { value: "price", label: "Variant price", kind: "number" },
  { value: "taxable", label: "Variant is taxable", kind: "boolean" },
];

const VARIANT_ACTION_FIELDS: { value: string; label: string; kind: UiKind }[] = [
  { value: "price", label: "Variant price", kind: "number" },
  { value: "compareAtPrice", label: "Variant compare-at price", kind: "number" },
  { value: "sku", label: "Variant SKU", kind: "string" },
  { value: "barcode", label: "Variant barcode", kind: "string" },
  { value: "inventoryPolicy", label: "Variant out-of-stock policy", kind: "status" },
  { value: "requiresShipping", label: "Variant requires shipping", kind: "boolean" },
  { value: "taxable", label: "Variant is taxable", kind: "boolean" },
  { value: "weight", label: "Variant weight", kind: "number" },
  { value: "weightUnit", label: "Variant weight unit", kind: "status" },
  { value: "costPerItem", label: "Variant cost per item", kind: "number" },
];

const COLLECTION_FILTER_FIELDS: { value: string; label: string; kind: UiKind }[] = [
  { value: "title", label: "Collection title", kind: "string" },
  { value: "handle", label: "Collection URL handle", kind: "string" },
];

const COLLECTION_ACTION_FIELDS: { value: string; label: string; kind: UiKind }[] = [
  { value: "title", label: "Collection title", kind: "string" },
  { value: "descriptionHtml", label: "Collection description HTML", kind: "string" },
  { value: "handle", label: "Collection URL handle", kind: "string" },
];

type ActionResult =
  | {
      preview: { count: number; precision: string; resourceIds: string[] };
      query: string;
    }
  | { error: string };

export default function NewTask() {
  const { prefill } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busy = navigation.state !== "idle";
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (navigation.state === "idle") setPendingIntent(null);
  }, [navigation.state]);

  const [resourceType, setResourceType] = useState<ResourceType>(
    prefill?.resourceType ?? "PRODUCT",
  );
  const [filterField, setFilterField] = useState(prefill?.filter?.field ?? "title");
  const [filterOperator, setFilterOperator] = useState(
    prefill?.filter?.operator ?? "contains",
  );
  const [actionField, setActionField] = useState(prefill?.action?.field ?? "title");
  const [operation, setOperation] = useState(
    prefill?.action?.operation ?? "set",
  );
  const [filterValue, setFilterValue] = useState(
    String(prefill?.filter?.value ?? ""),
  );
  const [actionValue, setActionValue] = useState(
    prefill?.action && prefill.action.operation !== "find_replace"
      ? String(prefill.action.value ?? "")
      : "",
  );

  const filterFields = resourceType === "PRODUCT" ? PRODUCT_FILTER_FIELDS : resourceType === "VARIANT" ? VARIANT_FILTER_FIELDS : COLLECTION_FILTER_FIELDS;
  const actionFields = resourceType === "PRODUCT" ? PRODUCT_ACTION_FIELDS : resourceType === "VARIANT" ? VARIANT_ACTION_FIELDS : COLLECTION_ACTION_FIELDS;

  const filterKind =
    filterFields.find((f) => f.value === filterField)?.kind ?? "string";
  const actionKind =
    actionFields.find((f) => f.value === actionField)?.kind ?? "string";
  const supportedVariantActions = new Set([
    "variantPrice", "variantCompareAtPrice", "variantSku", "variantBarcode",
    "variantTaxable", "variantInventoryPolicy",
  ]);
  const isVariantAction = resourceType === "PRODUCT" && actionField.startsWith("variant");
  const isPendingVariantAction = isVariantAction && !supportedVariantActions.has(actionField);

  const handleResourceTypeChange = (newType: ResourceType) => {
    setResourceType(newType);
    const firstFilter = (newType === "PRODUCT" ? PRODUCT_FILTER_FIELDS : newType === "VARIANT" ? VARIANT_FILTER_FIELDS : COLLECTION_FILTER_FIELDS)[0]?.value ?? "title";
    const firstAction = (newType === "PRODUCT" ? PRODUCT_ACTION_FIELDS : newType === "VARIANT" ? VARIANT_ACTION_FIELDS : COLLECTION_ACTION_FIELDS)[0]?.value ?? "title";
    setFilterField(firstFilter);
    setActionField(firstAction);
    setFilterOperator("contains");
    setOperation("set");
  };

  const handleFilterFieldChange = (newField: string) => {
    setFilterField(newField);
    const kind =
      filterFields.find((f) => f.value === newField)?.kind ?? "string";
    if (kind === "number" || kind === "date") setFilterOperator("greater_than");
    else if (kind === "status" || kind === "boolean") setFilterOperator("equals");
    else setFilterOperator("contains");
  };

  const handleActionFieldChange = (newField: string) => {
    setActionField(newField);
    setOperation("set");
  };

  const submitWithIntent = (intent: "preview" | "run" | "create") => {
    const form = formRef.current;
    if (!form) return;
    setPendingIntent(intent);
    const data = new FormData(form);
    data.set("intent", intent);
    submit(data, { method: "post" });
  };

  const isLoading = (intent: string) => busy && pendingIntent === intent;

  const preview = result && "preview" in result ? result.preview : undefined;
  const error = result && "error" in result ? result.error : undefined;

  return (
    <s-page heading="Create bulk edit" inlineSize="large">
      <s-button slot="secondary-actions" href="/app">
        Cancel
      </s-button>
      <Form ref={formRef} method="post">
        <s-stack direction="block" gap="large">
          {error && (
            <s-banner tone="critical" heading="Error">
              <s-paragraph>{error}</s-paragraph>
            </s-banner>
          )}

          {/* Task details */}
          <s-section heading="Task details">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="name"
                label="Task name"
                details="Give this edit a clear name so it's easy to find and undo later."
                placeholder="Example: Add summer tag to sandals"
                defaultValue={prefill?.name}
                required
              />
              <s-select
                name="resourceType"
                label="Resource"
                value={resourceType}
                onChange={(event) => {
                  const next = event.currentTarget.value as ResourceType;
                  setResourceType(next);
                  setFilterField("title");
                  setActionField("title");
                  setFilterOperator("contains");
                  setOperation("set");
                }}
              >
                <s-option value="PRODUCT">Products</s-option>
                <s-option value="COLLECTION">Collections</s-option>
              </s-select>
              {resourceType === "COLLECTION" && (
                <s-banner tone="warning" heading="Collection editing in progress">
                  <s-paragraph>
                    Preview and Apply are disabled until the Collection executor passes E2E Apply and Revert testing.
                  </s-paragraph>
                </s-banner>
              )}
            </s-stack>
          </s-section>

          {/* Filter products */}
          <s-section heading="Filter products">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Only products matching this condition will be included in the
                bulk edit.
              </s-paragraph>
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                gap="base"
              >
                {/* Field selector */}
                <s-select
                  name="filterField"
                  label="Field"
                  value={filterField}
                  onChange={(event) =>
                    handleFilterFieldChange(event.currentTarget.value)
                  }
                >
                  {filterFields.map((f) => (
                    <s-option key={f.value} value={f.value}>
                      {f.label}
                    </s-option>
                  ))}
                </s-select>

                {/* Condition / operator */}
                <s-select
                  name="filterOperator"
                  label="Condition"
                  value={filterOperator}
                  onChange={(event) =>
                    setFilterOperator(
                      event.currentTarget.value as FilterOperator,
                    )
                  }
                >
                  {filterKind === "number" || filterKind === "date" ? (
                    <>
                      <s-option value="greater_than">
                        {filterKind === "date" ? "After" : "Greater than"}
                      </s-option>
                      <s-option value="less_than">
                        {filterKind === "date" ? "Before" : "Less than"}
                      </s-option>
                      <s-option value="equals">Equals</s-option>
                      <s-option value="not_equals">Does not equal</s-option>
                      <s-option value="is_empty">Is empty</s-option>
                      <s-option value="is_not_empty">Is not empty</s-option>
                    </>
                  ) : filterKind === "status" || filterKind === "boolean" ? (
                    <>
                      <s-option value="equals">Is</s-option>
                      <s-option value="not_equals">Is not</s-option>
                    </>
                  ) : (
                    <>
                      <s-option value="contains">Contains</s-option>
                      <s-option value="equals">Equals</s-option>
                      <s-option value="not_contains">Does not contain</s-option>
                      <s-option value="not_equals">Does not equal</s-option>
                      <s-option value="is_empty">Is empty</s-option>
                      <s-option value="is_not_empty">Is not empty</s-option>
                    </>
                  )}
                </s-select>

                {/* Filter value input — varies by field kind */}
                {filterKind === "status" && filterField === "status" ? (
                  <s-select
                    name="filterValue"
                    label="Value"
                    value={filterValue || "ACTIVE"}
                    onChange={(event) => setFilterValue(event.currentTarget.value)}
                  >
                    <s-option value="ACTIVE">Active</s-option>
                    <s-option value="DRAFT">Draft</s-option>
                    <s-option value="ARCHIVED">Archived</s-option>
                  </s-select>
                ) : filterKind === "status" && filterField === "publishedStatus" ? (
                  <s-select
                    name="filterValue"
                    label="Value"
                    value={filterValue || "published"}
                    onChange={(event) => setFilterValue(event.currentTarget.value)}
                  >
                    <s-option value="published">Published</s-option>
                    <s-option value="unpublished">Unpublished</s-option>
                  </s-select>
                ) : filterKind === "boolean" ? (
                  <s-select
                    name="filterValue"
                    label="Value"
                    value={filterValue || "true"}
                    onChange={(event) => setFilterValue(event.currentTarget.value)}
                  >
                    <s-option value="true">True</s-option>
                    <s-option value="false">False</s-option>
                  </s-select>
                ) : filterKind === "date" ? (
                  <DatePicker
                    name="filterValue"
                    label="Date"
                    defaultValue={String(prefill?.filter?.value ?? "")}
                  />
                ) : filterKind === "number" ? (
                  <s-text-field
                    name="filterValue"
                    label="Value"
                    placeholder="0"
                    details="Enter a numeric value."
                    defaultValue={String(prefill?.filter?.value ?? "")}
                  />
                ) : filterField === "collectionId" ? (
                  <s-text-field
                    name="filterValue"
                    label="Collection ID"
                    placeholder="Numeric collection ID"
                    details="Enter the collection's numeric ID."
                    defaultValue={String(prefill?.filter?.value ?? "")}
                  />
                ) : (
                  <s-text-field
                    name="filterValue"
                    label="Value"
                    placeholder={
                      filterField === "tags"
                        ? "Example: summer"
                        : filterField === "handle"
                          ? "Example: my-product"
                          : filterField === "sku"
                            ? "Example: SKU-001"
                            : "Example: value"
                    }
                    defaultValue={String(prefill?.filter?.value ?? "")}
                  />
                )}
              </s-grid>
            </s-stack>
          </s-section>

          {/* Define the edit */}
          <s-section heading="Define the edit">
            <s-stack direction="block" gap="base">
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                gap="base"
              >
                {/* Action field */}
                <s-select
                  name="actionField"
                  label="Field to edit"
                  value={actionField}
                  onChange={(event) =>
                    handleActionFieldChange(event.currentTarget.value)
                  }
                >
                  {actionFields.map((f) => (
                    <s-option key={f.value} value={f.value}>
                      {f.label}
                    </s-option>
                  ))}
                </s-select>

                {/* Operation */}
                <s-select
                  name="operation"
                  label="Operation"
                  value={operation}
                  onChange={(event) =>
                    setOperation(
                      event.currentTarget.value as EditAction["operation"],
                    )
                  }
                >
                  {actionKind === "string_list" ? (
                    <>
                      <s-option value="set">Set (replace all)</s-option>
                      <s-option value="clear">Clear all</s-option>
                      <s-option value="add">Add tag</s-option>
                      <s-option value="remove">Remove tag</s-option>
                    </>
                  ) : actionKind === "status" ? (
                    <s-option value="set">Set status</s-option>
                  ) : (
                    <>
                      <s-option value="set">Set value</s-option>
                      <s-option value="clear">Clear value</s-option>
                      <s-option value="find_replace">Find and replace</s-option>
                      <s-option value="add">Append text</s-option>
                      <s-option value="remove">Remove text</s-option>
                    </>
                  )}
                </s-select>
              </s-grid>

              {isVariantAction && !isPendingVariantAction && (
                <s-banner tone="info" heading="Applies to all variants of matched products">
                  <s-paragraph>Each variant will be snapshotted separately so this edit can be reverted safely.</s-paragraph>
                </s-banner>
              )}

              {isPendingVariantAction && (
                <s-banner tone="warning" heading="Variant bulk edit coming soon">
                  <s-paragraph>
                    Variant fields are shown for planning. Preview and Apply will be enabled once the variant executor passes E2E testing.
                  </s-paragraph>
                </s-banner>
              )}

              {/* Action value — varies by operation and field kind */}
              {operation === "find_replace" ? (
                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                  gap="base"
                >
                  <s-text-field
                    name="find"
                    label="Find"
                    defaultValue={
                      prefill?.action?.operation === "find_replace"
                        ? prefill.action.find
                        : ""
                    }
                    required
                  />
                  <s-text-field
                    name="replace"
                    label="Replace with"
                    defaultValue={
                      prefill?.action?.operation === "find_replace"
                        ? prefill.action.replace
                        : ""
                    }
                  />
                </s-grid>
              ) : operation !== "clear" ? (
                actionField === "status" ? (
                  <s-select
                    name="actionValue"
                    label="New status"
                    value={actionValue || "ACTIVE"}
                    onChange={(event) => setActionValue(event.currentTarget.value)}
                  >
                    <s-option value="ACTIVE">Active</s-option>
                    <s-option value="DRAFT">Draft</s-option>
                    <s-option value="ARCHIVED">Archived</s-option>
                  </s-select>
                ) : actionField === "variantInventoryPolicy" ? (
                  <s-select
                    name="actionValue"
                    label="Out-of-stock policy"
                    value={actionValue || "DENY"}
                    onChange={(event) => setActionValue(event.currentTarget.value)}
                  >
                    <s-option value="DENY">Stop selling when out of stock</s-option>
                    <s-option value="CONTINUE">Continue selling when out of stock</s-option>
                  </s-select>
                ) : actionKind === "boolean" ? (
                  <s-select
                    name="actionValue"
                    label="New value"
                    value={actionValue || "true"}
                    onChange={(event) => setActionValue(event.currentTarget.value)}
                  >
                    <s-option value="true">True</s-option>
                    <s-option value="false">False</s-option>
                  </s-select>
                ) : (
                  <s-text-field
                    name="actionValue"
                    label={
                      operation === "add"
                        ? actionKind === "string_list"
                          ? "Tag to add"
                          : "Text to append"
                        : operation === "remove"
                          ? actionKind === "string_list"
                            ? "Tag to remove"
                            : "Text to remove"
                          : "New value"
                    }
                    placeholder={
                      actionField === "tags"
                        ? "Example: summer"
                        : actionField === "handle"
                          ? "new-url-handle"
                          : actionField === "templateSuffix"
                            ? "custom"
                            : "Enter value"
                    }
                    defaultValue={
                      prefill?.action &&
                      prefill.action.operation !== "find_replace"
                        ? String(prefill.action.value ?? "")
                        : ""
                    }
                    required
                  />
                )
              ) : null}
            </s-stack>
          </s-section>

          {/* Review and apply */}
          <s-section heading="Review and apply">
            {preview && (
              <input
                type="hidden"
                name="frozenIds"
                value={preview.resourceIds.join(",")}
              />
            )}
            {isPendingVariantAction && (
              <s-banner tone="warning" heading="Variant field executor coming soon">
                <s-paragraph>
                  Editing variant fields across all matched products requires a separate executor path. Preview and Apply are disabled until this passes end-to-end testing.
                </s-paragraph>
              </s-banner>
            )}
            {!isPendingVariantAction && preview ? (
              <s-banner
                tone="success"
                heading={`${preview.count} product${preview.count === 1 ? "" : "s"} matched`}
              >
                <s-paragraph>
                  Ready to edit. Click Apply Bulk Edit to run immediately, or
                  choose Schedule for later to set a future run time.
                </s-paragraph>
              </s-banner>
            ) : !isPendingVariantAction ? (
              <s-paragraph>
                Preview the selection first. No product data changes during this
                step.
              </s-paragraph>
            ) : null}
            <s-stack direction="inline" gap="base">
              <s-button
                type="button"
                onClick={() => submitWithIntent("preview")}
                disabled={busy || resourceType !== "PRODUCT" || isPendingVariantAction}
                loading={isLoading("preview")}
              >
                {isLoading("preview") ? "Checking…" : "Preview products"}
              </s-button>
              {!isPendingVariantAction && preview && (
                <>
                  <s-button
                    type="button"
                    onClick={() => submitWithIntent("run")}
                    variant="primary"
                    tone="critical"
                    disabled={busy}
                    loading={isLoading("run")}
                  >
                    {isLoading("run") ? "Applying…" : "Apply Bulk Edit"}
                  </s-button>
                  <s-button
                    type="button"
                    onClick={() => submitWithIntent("create")}
                    disabled={busy}
                    loading={isLoading("create")}
                  >
                    {isLoading("create") ? "Saving…" : "Schedule for later"}
                  </s-button>
                </>
              )}
            </s-stack>
          </s-section>
        </s-stack>
      </Form>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
