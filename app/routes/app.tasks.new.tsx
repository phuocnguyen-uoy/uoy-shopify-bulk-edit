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
import { useRef, useState } from "react";
import type { ResourceType } from "@prisma/client";
import { MultiRuleBuilder } from "../components/MultiRuleBuilder";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { compileProductSearch } from "../services/bulk-edit/filter-compiler";
import { discoverTargetIds } from "../services/bulk-edit/target-discovery.server";
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
      filters,
      actions: actions.actions,
      filter: filters.conditions[0] ?? null,
      action: actions.actions[0] ?? null,
    },
  };
};

function parseJson<T>(raw: FormDataEntryValue | null, label: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    throw new Response(`Invalid ${label} JSON`, { status: 422 });
  }
}

function readConfiguration(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) throw new Response("Task name is required", { status: 422 });
  const resourceType = String(
    form.get("resourceType") ?? "PRODUCT",
  ) as ResourceType;
  if (
    resourceType !== "PRODUCT" &&
    resourceType !== "COLLECTION" &&
    resourceType !== "VARIANT"
  ) {
    throw new Response("Unsupported resource type", { status: 422 });
  }

  const filters = parseJson<FilterDefinition>(
    form.get("filtersJson"),
    "filters",
  ) ?? {
    combinator: "and" as const,
    conditions: [
      {
        field: String(form.get("filterField") ?? "").trim(),
        operator: String(form.get("filterOperator") ?? "") as FilterOperator,
        value: String(form.get("filterValue") ?? "").trim(),
      },
    ],
  };
  const actions = parseJson<{ actions: EditAction[] }>(
    form.get("actionsJson"),
    "actions",
  ) ?? {
    actions: [
      {
        field: String(form.get("actionField") ?? "").trim(),
        operation: String(
          form.get("operation") ?? "set",
        ) as EditAction["operation"],
        value: String(form.get("actionValue") ?? ""),
        find: String(form.get("find") ?? ""),
        replace: String(form.get("replace") ?? ""),
      },
    ],
  };

  if (
    !["and", "or"].includes(filters.combinator) ||
    !Array.isArray(filters.conditions) ||
    filters.conditions.length < 1 ||
    filters.conditions.length > 50
  ) {
    throw new Response("Add between 1 and 50 valid filter conditions", {
      status: 422,
    });
  }
  if (
    !Array.isArray(actions.actions) ||
    actions.actions.length < 1 ||
    actions.actions.length > 50
  ) {
    throw new Response("Add between 1 and 50 valid edit actions", {
      status: 422,
    });
  }

  for (const condition of filters.conditions) {
    if (
      !condition ||
      typeof condition.field !== "string" ||
      typeof condition.operator !== "string"
    ) {
      throw new Response("Invalid filter condition", { status: 422 });
    }
    const definition = requireField(resourceType, condition.field);
    if (!definition.filterOperators.includes(condition.operator)) {
      throw new Response(
        `Operator ${condition.operator} is invalid for ${condition.field}`,
        { status: 422 },
      );
    }
    const hasValue =
      condition.value !== undefined && String(condition.value).trim() !== "";
    const hasValues =
      Array.isArray(condition.values) && condition.values.length > 0;
    const hasUpper =
      condition.valueTo !== undefined &&
      String(condition.valueTo).trim() !== "";
    if (
      !condition.operator.startsWith("is_") &&
      ((!hasValue && !hasValues) ||
        (condition.operator === "between" && !hasUpper))
    ) {
      throw new Response(`Filter value is required for ${condition.field}`, {
        status: 422,
      });
    }
  }

  const validOps = new Set([
    "set",
    "clear",
    "find_replace",
    "regex_replace",
    "text_transform",
    "add",
    "remove",
    "increase_fixed",
    "decrease_fixed",
    "increase_percent",
    "decrease_percent",
  ]);
  for (const edit of actions.actions) {
    if (
      !edit ||
      typeof edit.field !== "string" ||
      !validOps.has(edit.operation)
    ) {
      throw new Response("Unsupported edit action", { status: 422 });
    }
    const definition = requireField(resourceType, edit.field);
    if (!definition.editable)
      throw new Response(`Action field is read-only: ${edit.field}`, {
        status: 422,
      });
    if (
      (edit.operation === "find_replace" ||
        edit.operation === "regex_replace") &&
      !edit.find
    ) {
      throw new Response("Find or regex pattern is required", { status: 422 });
    }
    if (edit.operation === "text_transform" && !edit.textTransform) {
      throw new Response("Text transform is required", { status: 422 });
    }
  }
  if (resourceType === "PRODUCT") {
    const scopes = new Set(
      actions.actions.map((edit) =>
        edit.field.startsWith("variant") ? "variant" : "product",
      ),
    );
    if (scopes.size > 1) {
      throw new Response(
        "A task cannot mix product and variant actions. Create separate tasks so preview, execution, and rollback stay consistent.",
        { status: 422 },
      );
    }
  }
  return { name, resourceType, filters, actions };
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
      const frozenResourceIds = await discoverTargetIds(
        admin,
        configuration.resourceType,
        query,
        configuration.filters,
      );
      if (frozenResourceIds.length === 0) {
        throw new Response("No resources match this filter", { status: 422 });
      }

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

    const resourceIds = await discoverTargetIds(
      admin,
      configuration.resourceType,
      query,
      configuration.filters,
    );
    if (resourceIds.length === 0) {
      throw new Response("No resources match this filter", { status: 422 });
    }
    return { preview: { count: resourceIds.length } };
  } catch (e) {
    if (e instanceof Response) {
      const message = await e.text();
      return { error: message };
    }
    throw e;
  }
};
// ── Client-side field metadata ────────────────────────────────────────────────

type UiKind =
  "string" | "string_list" | "number" | "date" | "status" | "boolean";

const PRODUCT_FILTER_FIELDS: { value: string; label: string; kind: UiKind }[] =
  [
    // Product fields
    { value: "title", label: "Product title", kind: "string" },
    { value: "vendor", label: "Product vendor", kind: "string" },
    { value: "productType", label: "Product type", kind: "string" },
    { value: "status", label: "Product status", kind: "status" },
    { value: "tags", label: "Product tags", kind: "string_list" },
    { value: "handle", label: "Product URL handle", kind: "string" },
    { value: "collectionId", label: "Product collection", kind: "string" },
    {
      value: "totalInventory",
      label: "Product total inventory",
      kind: "number",
    },
    { value: "variantsCount", label: "Product variants count", kind: "number" },
    { value: "publishedAt", label: "Product published at", kind: "date" },
    { value: "createdAt", label: "Product created at", kind: "date" },
    { value: "updatedAt", label: "Product updated at", kind: "date" },
    {
      value: "publishedStatus",
      label: "Product published status",
      kind: "status",
    },
    {
      value: "hasOnlyDefaultVariant",
      label: "Has only default variant",
      kind: "boolean",
    },
    { value: "isGiftCard", label: "Is gift card", kind: "boolean" },
    {
      value: "hasOutOfStockVariants",
      label: "Has out-of-stock variants",
      kind: "boolean",
    },
    {
      value: "requiresSellingPlan",
      label: "Requires subscription",
      kind: "boolean",
    },
    { value: "variantTaxable", label: "Variant is taxable", kind: "boolean" },
    // Variant fields (filterable via Shopify product search)
    { value: "variantTitle", label: "Variant title", kind: "string" },
    { value: "sku", label: "Variant SKU", kind: "string" },
    { value: "barcode", label: "Variant barcode", kind: "string" },
    { value: "price", label: "Variant price", kind: "number" },
  ];

const PRODUCT_ACTION_FIELDS: { value: string; label: string; kind: UiKind }[] =
  [
    { value: "title", label: "Title", kind: "string" },
    { value: "descriptionHtml", label: "Description (HTML)", kind: "string" },
    { value: "vendor", label: "Vendor", kind: "string" },
    { value: "productType", label: "Product type", kind: "string" },
    { value: "status", label: "Status", kind: "status" },
    { value: "tags", label: "Tags", kind: "string_list" },
    { value: "handle", label: "URL handle", kind: "string" },
    { value: "seoTitle", label: "SEO page title", kind: "string" },
    { value: "seoDescription", label: "SEO meta description", kind: "string" },
    {
      value: "templateSuffix",
      label: "Product · Theme template suffix",
      kind: "string",
    },
    { value: "variantPrice", label: "Variant · Price", kind: "number" },
    {
      value: "variantCompareAtPrice",
      label: "Variant · Compare-at price",
      kind: "number",
    },
    { value: "variantSku", label: "Variant · SKU", kind: "string" },
    { value: "variantBarcode", label: "Variant · Barcode", kind: "string" },
    { value: "variantTaxable", label: "Variant · Is taxable", kind: "boolean" },
    { value: "variantWeight", label: "Variant · Weight", kind: "number" },
    {
      value: "variantWeightUnit",
      label: "Variant · Weight unit",
      kind: "status",
    },
    {
      value: "variantRequiresShipping",
      label: "Variant · Requires shipping",
      kind: "boolean",
    },
    {
      value: "variantInventoryPolicy",
      label: "Variant · Out-of-stock policy",
      kind: "status",
    },
    {
      value: "variantCostPerItem",
      label: "Variant · Cost per item",
      kind: "number",
    },
  ];

const VARIANT_FILTER_FIELDS: { value: string; label: string; kind: UiKind }[] =
  [
    { value: "title", label: "Variant title", kind: "string" },
    { value: "sku", label: "Variant SKU", kind: "string" },
    { value: "barcode", label: "Variant barcode", kind: "string" },
    { value: "price", label: "Variant price", kind: "number" },
    { value: "taxable", label: "Variant is taxable", kind: "boolean" },
  ];

const VARIANT_ACTION_FIELDS: { value: string; label: string; kind: UiKind }[] =
  [
    { value: "price", label: "Variant price", kind: "number" },
    {
      value: "compareAtPrice",
      label: "Variant compare-at price",
      kind: "number",
    },
    { value: "sku", label: "Variant SKU", kind: "string" },
    { value: "barcode", label: "Variant barcode", kind: "string" },
    {
      value: "inventoryPolicy",
      label: "Variant out-of-stock policy",
      kind: "status",
    },
    { value: "taxable", label: "Variant is taxable", kind: "boolean" },
  ];

const COLLECTION_FILTER_FIELDS: {
  value: string;
  label: string;
  kind: UiKind;
}[] = [
  { value: "title", label: "Collection title", kind: "string" },
  { value: "handle", label: "Collection URL handle", kind: "string" },
];

const COLLECTION_ACTION_FIELDS: {
  value: string;
  label: string;
  kind: UiKind;
}[] = [
  { value: "title", label: "Collection title", kind: "string" },
  {
    value: "descriptionHtml",
    label: "Collection description HTML",
    kind: "string",
  },
  { value: "handle", label: "Collection URL handle", kind: "string" },
];

export default function NewTask() {
  const { prefill } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busy = navigation.state !== "idle";
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [resourceType, setResourceType] = useState<ResourceType>(
    prefill?.resourceType ?? "PRODUCT",
  );

  const filterFields =
    resourceType === "PRODUCT"
      ? PRODUCT_FILTER_FIELDS
      : resourceType === "VARIANT"
        ? VARIANT_FILTER_FIELDS
        : COLLECTION_FILTER_FIELDS;
  const actionFields =
    resourceType === "PRODUCT"
      ? PRODUCT_ACTION_FIELDS
      : resourceType === "VARIANT"
        ? VARIANT_ACTION_FIELDS
        : COLLECTION_ACTION_FIELDS;

  const supportedVariantActions = new Set([
    "variantPrice",
    "variantCompareAtPrice",
    "variantSku",
    "variantBarcode",
    "variantTaxable",
    "variantInventoryPolicy",
  ]);
  const isPendingVariantAction = false;

  const handleResourceTypeChange = (newType: ResourceType) => {
    setResourceType(newType);
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
                  handleResourceTypeChange(
                    event.currentTarget.value as ResourceType,
                  );
                }}
              >
                <s-option value="PRODUCT">Products</s-option>
                <s-option value="VARIANT">Product Variants</s-option>
                <s-option value="COLLECTION">Collections</s-option>
              </s-select>
            </s-stack>
          </s-section>

          <MultiRuleBuilder
            key={resourceType}
            filterFields={filterFields}
            actionFields={actionFields.filter(
              (field) =>
                !field.value.startsWith("variant") ||
                supportedVariantActions.has(field.value),
            )}
            initialFilters={
              resourceType === prefill?.resourceType
                ? prefill.filters
                : undefined
            }
            initialActions={
              resourceType === prefill?.resourceType
                ? prefill.actions
                : undefined
            }
          />
          {/* Review and apply */}
          <s-section heading="Review and apply">
            {isPendingVariantAction && (
              <s-banner
                tone="warning"
                heading="Variant field executor coming soon"
              >
                <s-paragraph>
                  Editing variant fields across all matched products requires a
                  separate executor path. Preview and Apply are disabled until
                  this passes end-to-end testing.
                </s-paragraph>
              </s-banner>
            )}
            {!isPendingVariantAction && preview ? (
              <s-banner
                tone="success"
                heading={`${preview.count} ${
                resourceType === "COLLECTION"
                  ? `collection${preview.count === 1 ? "" : "s"}`
                  : resourceType === "VARIANT"
                    ? `variant${preview.count === 1 ? "" : "s"}`
                    : `product${preview.count === 1 ? "" : "s"}`
              } matched`}
              >
                <s-paragraph>
                  Ready to edit. Click Apply Bulk Edit to run immediately, or
                  choose Schedule for later to set a future run time.
                </s-paragraph>
              </s-banner>
            ) : !isPendingVariantAction ? (
              <s-paragraph>
                Preview the selection first. No{" "}
                {resourceType === "COLLECTION"
                  ? "collection"
                  : resourceType === "VARIANT"
                    ? "variant"
                    : "product"}{" "}
                data changes during this step.
              </s-paragraph>
            ) : null}


            <s-stack direction="inline" gap="base">
              <s-button
                type="button"
                onClick={() => submitWithIntent("preview")}
                disabled={busy || isPendingVariantAction}
                loading={isLoading("preview")}
              >
                {isLoading("preview")
                  ? "Checking…"
                  : `Preview ${
                      resourceType === "COLLECTION"
                        ? "collections"
                        : resourceType === "VARIANT"
                          ? "variants"
                          : "products"
                    }`}
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
