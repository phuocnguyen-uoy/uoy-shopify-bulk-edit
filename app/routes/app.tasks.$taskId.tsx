import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSubmit,
} from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import { executeRun } from "../services/jobs/execute.server";
import { reconcileRun } from "../services/jobs/reconcile.server";
import { authenticate } from "../shopify.server";
import { tenantDb } from "../services/tenant.server";
import {
  enqueueRollback,
  enqueueTaskNow,
} from "../services/tasks/task-service.server";
import { scheduleTask } from "../services/scheduler/scheduler.server";
import type {
  FilterDefinition,
  ActionDefinition,
  FilterCondition,
  EditAction,
} from "../services/tasks/types";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!params.taskId)
    throw new Response("Task id is required", { status: 400 });
  const task = await tenantDb(db, session.shop).task.findDetail(params.taskId);
  if (!task) throw new Response("Task not found", { status: 404 });
  const runningRuns = task.runs.filter((run) => run.status === "RUNNING");
  if (runningRuns.length > 0) {
    await Promise.allSettled(
      runningRuns.map((run) => reconcileRun(session.shop, run.id)),
    );
  }
  const refreshedTask =
    runningRuns.length > 0
      ? await tenantDb(db, session.shop).task.findDetail(params.taskId)
      : task;
  if (!refreshedTask)
    throw new Response("Task not found", { status: 404 });
  const latestRun = refreshedTask.runs.find((run) => run._count.changes > 0);
  const runDetail = latestRun
    ? await tenantDb(db, session.shop).taskRun.findRunDetail(latestRun.id)
    : null;
  const labels = new Map<
    string,
    { title: string; productTitle?: string; imageUrl?: string }
  >();
  if (runDetail?.changes.length) {
    const response = await admin.graphql(
      `#graphql
      query TaskChangedProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title featuredImage { url } }
          ... on ProductVariant {
            id title image { url }
            product { title featuredImage { url } }
          }
        }
      }`,
      {
        variables: {
          ids: runDetail.changes.map((change) => change.resourceGid),
        },
      },
    );
    if (response.ok) {
      const body = (await response.json()) as {
        data?: {
          nodes?: Array<{
            id: string;
            title: string;
            featuredImage?: { url: string } | null;
            image?: { url: string } | null;
            product?: {
              title: string;
              featuredImage?: { url: string } | null;
            };
          } | null>;
        };
      };
      for (const node of body.data?.nodes ?? []) {
        if (node) {
          labels.set(node.id, {
            title: node.title,
            productTitle: node.product?.title,
            imageUrl:
              node.image?.url ??
              node.featuredImage?.url ??
              node.product?.featuredImage?.url,
          });
        }
      }
    }
  }
  return {
    task: {
      id: refreshedTask.id,
      name: refreshedTask.name,
      resourceType: refreshedTask.resourceType,
      status: refreshedTask.status,
      filterDefinition: refreshedTask.filterDefinition as FilterDefinition,
      actionDefinition: refreshedTask.actionDefinition as ActionDefinition,
      scheduledAt: refreshedTask.scheduledAt?.toISOString() ?? null,
      recurringCron: refreshedTask.recurringCron,
      runs: refreshedTask.runs.map((run) => ({
        id: run.id,
        kind: run.kind,
        status: run.status,
        scheduledFor: run.scheduledFor.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        changeCount: run._count.changes,
        canRollback: run.kind === "APPLY" && run.status === "COMPLETED",
      })),
      latestChanges: (runDetail?.changes ?? []).map((change) => {
        const label = labels.get(change.resourceGid);
        return {
          id: change.id,
          name:
            [label?.productTitle, label?.title].filter(Boolean).join(" — ") ||
            change.resourceGid.split("/").slice(-2).join(" "),
          imageUrl: label?.imageUrl,
          resourceType: change.resourceType,
          before: change.before as Record<string, unknown>,
          after: change.after as Record<string, unknown>,
        };
      }),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!params.taskId)
    throw new Response("Task id is required", { status: 400 });
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "run_now" || intent === "run_again") {
    const run = await enqueueTaskNow(session.shop, params.taskId);
    await executeRun(session.shop, run.id);
  } else if (intent === "delete") {
    const scoped = tenantDb(db, session.shop);
    await db.task.updateMany({
      where: { id: params.taskId, shopDomain: scoped.shopDomain },
      data: { status: "ARCHIVED" },
    });
    return redirect("/app");
  } else if (intent === "rollback") {
    const sourceRunId = String(form.get("sourceRunId") ?? "");
    if (!sourceRunId)
      throw new Response("Source run id is required", { status: 422 });
    const rollbackRun = await enqueueRollback(
      session.shop,
      params.taskId,
      sourceRunId,
    );
    await executeRun(session.shop, rollbackRun.id);
  } else if (intent === "schedule") {
    const rawRunAt = String(form.get("runAt") ?? "");
    const runAt = new Date(
      rawRunAt.includes("T") && !rawRunAt.endsWith("Z")
        ? rawRunAt + "Z"
        : rawRunAt,
    );
    if (!rawRunAt || Number.isNaN(runAt.getTime()))
      throw new Response("Valid run time is required", { status: 422 });
    const timezone = String(form.get("timezone") ?? "UTC").trim() || "UTC";
    const recurringCron =
      String(form.get("recurringCron") ?? "").trim() || undefined;
    await scheduleTask(session.shop, params.taskId, {
      runAt,
      timezone,
      recurringCron,
    });
  } else {
    throw new Response("Unsupported action", { status: 400 });
  }
  return redirect("/app/tasks/" + params.taskId);
};

type BadgeTone =
  | "info"
  | "success"
  | "caution"
  | "critical"
  | "neutral"
  | "warning";

const STATUS_TONE: Record<string, BadgeTone> = {
  COMPLETED: "success",
  QUEUED: "info",
  PREPARING: "info",
  RUNNING: "info",
  PARTIALLY_FAILED: "caution",
  FAILED: "critical",
  CANCELLED: "caution",
};

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  descriptionHtml: "Description",
  vendor: "Vendor",
  productType: "Product type",
  status: "Status",
  tags: "Tags",
  collectionId: "Collection",
  totalInventory: "Total inventory",
  sku: "SKU",
  barcode: "Barcode",
  price: "Price",
  handle: "Handle",
  templateSuffix: "Template suffix",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  publishedStatus: "Published status",
  hasOutOfStockVariants: "Has out-of-stock variants",
  requiresSellingPlan: "Requires selling plan",
  variantTaxable: "Variant taxable",
  variantPrice: "Variant price",
  variantCompareAtPrice: "Variant compare-at price",
  variantSku: "Variant SKU",
  variantBarcode: "Variant barcode",
  variantInventoryPolicy: "Variant inventory policy",
  compareAtPrice: "Compare-at price",
  taxable: "Taxable",
  weight: "Weight",
  weightUnit: "Weight unit",
  inventoryPolicy: "Inventory policy",
  requiresShipping: "Requires shipping",
  inventoryQuantity: "Inventory quantity",
  costPerItem: "Cost per item",
};

const OPERATOR_LABEL: Record<string, string> = {
  equals: "equals",
  not_equals: "not equals",
  contains: "contains",
  not_contains: "does not contain",
  greater_than: "greater than",
  less_than: "less than",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const OPERATION_LABEL: Record<string, string> = {
  set: "Set to",
  clear: "Clear",
  find_replace: "Find/Replace",
  add: "Add",
  remove: "Remove",
  increase_fixed: "Increase by",
  increase_percent: "Increase by %",
  decrease_fixed: "Decrease by",
  decrease_percent: "Decrease by %",
};

function conditionLabel(c: FilterCondition) {
  const field = FIELD_LABEL[c.field] ?? c.field;
  const op = OPERATOR_LABEL[c.operator] ?? c.operator;
  if (c.operator === "is_empty" || c.operator === "is_not_empty") {
    return `${field} ${op}`;
  }
  return `${field} ${op} "${c.value}"`;
}

function actionLabel(a: EditAction) {
  const field = FIELD_LABEL[a.field] ?? a.field;
  const op = OPERATION_LABEL[a.operation] ?? a.operation;
  if (a.operation === "clear") return `${field}: Clear`;
  if (a.operation === "find_replace")
    return `${field}: Find "${a.find}" → "${a.replace}"`;
  return `${field}: ${op} "${a.value}"`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function TaskDetail() {
  const { task } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const busy = navigation.state !== "idle";

  const hasActiveRun = task.runs.some((r) =>
    ["QUEUED", "PREPARING", "RUNNING"].includes(r.status),
  );

  useEffect(() => {
    if (!hasActiveRun) return;
    const id = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(id);
  }, [hasActiveRun, revalidator]);

  const act = (intent: string) => {
    const data = new FormData();
    data.set("intent", intent);
    submit(data, { method: "post" });
  };

  const filters = task.filterDefinition?.conditions ?? [];
  const actions = task.actionDefinition?.actions ?? [];

  return (
    <s-page heading={task.name} inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        type="button"
        disabled={busy || hasActiveRun}
        onClick={() => act("run_now")}
      >
        Run again
      </s-button>
      <s-button slot="secondary-actions" href="/app">
        All tasks
      </s-button>
      <s-button
        slot="secondary-actions"
        href={`/app/tasks/new?copyFrom=${task.id}`}
      >
        Edit as new
      </s-button>
      <s-button
        slot="secondary-actions"
        type="button"
        tone="critical"
        disabled={busy || hasActiveRun}
        onClick={() => act("delete")}
      >
        Delete
      </s-button>

      {hasActiveRun && (
        <s-banner tone="info" heading="Bulk edit is running…">
          <s-paragraph>
            Shopify is processing your changes. This page refreshes
            automatically — products will be updated in a minute or two.
          </s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="large">
        <s-section heading="Filters">
          {filters.length === 0 ? (
            <s-paragraph>No filters — matches all {task.resourceType.toLowerCase()}s.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              <s-text>
                Match{" "}
                <s-text type="strong">
                  {task.filterDefinition.combinator === "and" ? "ALL" : "ANY"}
                </s-text>{" "}
                of the following:
              </s-text>
              <s-stack direction="block" gap="small">
                {filters.map((c, i) => (
                  <s-box key={i} padding="small" border="base" borderRadius="base">
                    <s-text>{conditionLabel(c)}</s-text>
                  </s-box>
                ))}
              </s-stack>
            </s-stack>
          )}
        </s-section>

        <s-section heading="Actions">
          {actions.length === 0 ? (
            <s-paragraph>No actions configured.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {actions.map((a, i) => (
                <s-box key={i} padding="small" border="base" borderRadius="base">
                  <s-text>{actionLabel(a)}</s-text>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>

        <s-section heading="Schedule">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {task.recurringCron
                ? `Recurring: ${task.recurringCron}`
                : task.scheduledAt
                  ? `Scheduled: ${fmtDate(task.scheduledAt)}`
                  : "Not scheduled — use the form below to schedule a future run."}
            </s-paragraph>
            <Form method="post">
              <s-stack direction="block" gap="base">
                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
                  gap="base"
                >
                  <s-text-field
                    name="runAt"
                    label="Run at (local time)"
                    placeholder="YYYY-MM-DDTHH:mm"
                    details="Enter the run time in UTC."
                    required
                  />
                  <s-text-field
                    name="timezone"
                    label="Timezone"
                    value="UTC"
                    placeholder="UTC"
                  />
                  <s-text-field
                    name="recurringCron"
                    label="Recurring cron"
                    placeholder="Optional — e.g. 0 9 * * 1"
                  />
                </s-grid>
                <input type="hidden" name="intent" value="schedule" />
                <s-button type="submit" disabled={busy}>
                  Set schedule
                </s-button>
              </s-stack>
            </Form>
          </s-stack>
        </s-section>

        <s-section heading="Products changed">
          {task.latestChanges.length === 0 ? (
            <s-paragraph>No product changes recorded yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="base">
              {task.latestChanges.map((change) => (
                <s-box
                  key={change.id}
                  padding="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small">
                      {change.imageUrl && (
                        <img
                          src={change.imageUrl}
                          alt=""
                          width={48}
                          height={48}
                          style={{ borderRadius: 8, objectFit: "cover" }}
                        />
                      )}
                      <s-text type="strong">{change.name}</s-text>
                      <s-badge tone="neutral">
                        {change.resourceType.toLowerCase()}
                      </s-badge>
                    </s-stack>
                    {Array.from(
                      new Set([
                        ...Object.keys(change.before),
                        ...Object.keys(change.after),
                      ]),
                    ).map((field) => (
                      <s-stack key={field} direction="inline" gap="base">
                        <s-text type="strong">
                          {FIELD_LABEL[field] ?? field}
                        </s-text>
                        <s-text>{displayValue(change.before[field])}</s-text>
                        <s-text>→</s-text>
                        <s-text tone="success">
                          {displayValue(change.after[field])}
                        </s-text>
                      </s-stack>
                    ))}
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>

        <s-section heading="Run history">
          {task.runs.length === 0 ? (
            <s-paragraph>This task has not run yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="base">
              {task.runs.map((run) => (
                <s-box
                  key={run.id}
                  padding="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small">
                      <s-badge
                        tone={run.kind === "APPLY" ? "neutral" : "warning"}
                      >
                        {run.kind === "APPLY" ? "Bulk edit" : "Rollback"}
                      </s-badge>
                      <s-badge tone={STATUS_TONE[run.status] ?? "neutral"}>
                        {run.status.toLowerCase().replace("_", " ")}
                      </s-badge>
                      {run.changeCount > 0 && (
                        <s-badge tone="info">
                          {run.changeCount}{" "}
                          {run.changeCount === 1 ? "product" : "products"} changed
                        </s-badge>
                      )}
                    </s-stack>
                    <s-stack direction="block" gap="small">
                      <s-text>Scheduled: {fmtDate(run.scheduledFor)}</s-text>
                      {run.completedAt && (
                        <s-text>Completed: {fmtDate(run.completedAt)}</s-text>
                      )}
                    </s-stack>
                    <s-stack direction="inline" gap="small">
                      {run.canRollback && (
                        <s-button
                          type="button"
                          tone="critical"
                          disabled={busy}
                          onClick={() => {
                            const data = new FormData();
                            data.set("intent", "rollback");
                            data.set("sourceRunId", run.id);
                            submit(data, { method: "post" });
                          }}
                        >
                          Rollback this run
                        </s-button>
                      )}
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
