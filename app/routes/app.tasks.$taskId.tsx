import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSubmit,
} from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { DatePicker } from "../components/DatePicker";

import db from "../db.server";
import { executeRun } from "../services/jobs/execute.server";
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

  // Reconciliation runs inside /app/api/task-status/:id (the polling endpoint),
  // not here — so navigation is never blocked by a Shopify API call.
  const hasActiveRun = task.runs.some((run) =>
    ["QUEUED", "PREPARING", "RUNNING"].includes(run.status),
  );

  // Skip label fetch while a run is active: polling will trigger a full
  // revalidation once the run reaches a terminal state.
  const latestRun = !hasActiveRun
    ? task.runs.find((run) => run._count.changes > 0)
    : null;
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
          ... on Collection { id title image { url } }
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
      id: task.id,
      name: task.name,
      resourceType: task.resourceType,
      status: task.status,
      filterDefinition: task.filterDefinition as FilterDefinition,
      actionDefinition: task.actionDefinition as ActionDefinition,
      scheduledAt: task.scheduledAt?.toISOString() ?? null,
      recurringCron: task.recurringCron,
      runs: task.runs.map((run) => ({
        id: run.id,
        kind: run.kind,
        status: run.status,
        scheduledFor: run.scheduledFor.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        changeCount: run._count.changes,
        canRollback: run.kind === "APPLY" && run.status === "COMPLETED",
        stats: run.stats as { totalCount?: number; processedCount?: number } | null,
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
    try {
      await executeRun(session.shop, rollbackRun.id);
    } catch (err) {
      return {
        revertError: err instanceof Error ? err.message : "Revert failed",
        sourceRunId,
      };
    }
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
  const d = new Date(iso);
  const Y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const H = String(d.getHours()).padStart(2, "0");
  const i = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${Y}/${m}/${day} ${H}:${i}:${s}`;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

type PolledRun = {
  id: string;
  kind: string;
  status: string;
  scheduledFor: string;
  completedAt: string | null;
  changeCount: number;
  stats: { totalCount?: number; processedCount?: number } | null;
};

const ACTIVE_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING"]);

export default function TaskDetail() {
  const { task } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const statusFetcher = useFetcher<{ runs: PolledRun[] }>();
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const busy = navigation.state !== "idle";

  const revertError = actionData && "revertError" in actionData ? actionData.revertError : null;

  // Merge loader runs with the most recent polled statuses so progress updates
  // without a full page reload. Re-derive canRollback from polled status.
  const mergedRuns = useMemo(() => {
    if (!statusFetcher.data) return task.runs;
    const polledMap = new Map(statusFetcher.data.runs.map((r) => [r.id, r]));
    return task.runs.map((r) => {
      const p = polledMap.get(r.id);
      if (!p) return r;
      return {
        ...r,
        status: p.status,
        stats: p.stats,
        changeCount: p.changeCount,
        completedAt: p.completedAt,
        canRollback: r.kind === "APPLY" && p.status === "COMPLETED",
      };
    });
  }, [task.runs, statusFetcher.data]);

  const hasActiveRun = mergedRuns.some((r) => ACTIVE_STATUSES.has(r.status));

  // Detect active→terminal transition and trigger one full revalidation so the
  // changes section and labels load. A ref avoids the double-fire problem.
  const hasRevalidatedRef = useRef(false);
  const prevHasActiveRef = useRef(hasActiveRun);
  useEffect(() => {
    const wasActive = prevHasActiveRef.current;
    prevHasActiveRef.current = hasActiveRun;
    if (hasActiveRun) {
      hasRevalidatedRef.current = false;
    } else if (wasActive && !hasRevalidatedRef.current) {
      hasRevalidatedRef.current = true;
      revalidator.revalidate();
    }
  }, [hasActiveRun, revalidator]);

  // Poll the lightweight status endpoint every 2 s while a run is active.
  // Only schedule the next poll after the current fetch is idle to avoid stacking.
  useEffect(() => {
    if (!hasActiveRun) return;
    if (statusFetcher.state !== "idle") return;
    const id = setTimeout(() => {
      statusFetcher.load(`/app/api/task-status/${task.id}`);
    }, 2000);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveRun, statusFetcher.state, statusFetcher.data, task.id]);

  const act = (intent: string, extraData?: Record<string, string>) => {
    setPendingIntent(intent);
    const data = new FormData();
    data.set("intent", intent);
    if (extraData) {
      for (const [k, v] of Object.entries(extraData)) data.set(k, v);
    }
    submit(data, { method: "post" });
  };

  const isLoading = (intent: string) => busy && pendingIntent === intent;

  const filters = task.filterDefinition?.conditions ?? [];
  const actions = task.actionDefinition?.actions ?? [];

  return (
    <s-page heading={task.name} inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        type="button"
        disabled={busy || hasActiveRun}
        loading={isLoading("run_now")}
        onClick={() => act("run_now")}
      >
        {isLoading("run_now") ? "Starting…" : "Run again"}
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
        loading={isLoading("delete")}
        onClick={() => {
          if (!window.confirm("Delete this task? This cannot be undone.")) return;
          act("delete");
        }}
      >
        {isLoading("delete") ? "Deleting…" : "Delete"}
      </s-button>

      {revertError && (
        <s-banner tone="critical" heading="Revert failed">
          <s-paragraph>{revertError}</s-paragraph>
          <s-paragraph>A resource may have been changed after the bulk edit ran. Please check the current values and revert manually if needed.</s-paragraph>
        </s-banner>
      )}

      {hasActiveRun && (() => {
        const activeRun = mergedRuns.find((r) =>
          ACTIVE_STATUSES.has(r.status),
        );
        const progress = activeRun?.stats?.totalCount
          ? `${activeRun.stats.processedCount ?? 0} / ${activeRun.stats.totalCount} items processed.`
          : null;
        return (
          <s-banner tone="info" heading="Bulk edit is running…">
            <s-paragraph>
              Shopify is processing your changes.{progress ? ` ${progress}` : ""}{" "}
              This page refreshes automatically — products will be updated in a minute or two.
            </s-paragraph>
          </s-banner>
        );
      })()}

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
                  <DatePicker
                    name="runAt"
                    label="Run at (local time)"
                    includeTime
                    required
                    hint="Time is in your browser's local timezone."
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
                <s-button
                  type="submit"
                  disabled={busy}
                  loading={isLoading("schedule")}
                  onClick={() => setPendingIntent("schedule")}
                >
                  {isLoading("schedule") ? "Saving…" : "Set schedule"}
                </s-button>
              </s-stack>
            </Form>
          </s-stack>
        </s-section>

        <s-section heading={`${task.resourceType === "COLLECTION" ? "Collections" : "Products"} changed`}>
          {task.latestChanges.length === 0 ? (
            <s-paragraph>No {task.resourceType === "COLLECTION" ? "collection" : "product"} changes recorded yet.</s-paragraph>
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
          {mergedRuns.length === 0 ? (
            <s-paragraph>This task has not run yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="base">
              {mergedRuns.map((run) => (
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
                          {run.changeCount === 1
                            ? task.resourceType === "COLLECTION" ? "collection" : "product"
                            : task.resourceType === "COLLECTION" ? "collections" : "products"} changed
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
                          loading={isLoading("rollback")}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Revert this run? All ${task.resourceType === "COLLECTION" ? "collection" : "product"} changes from this run will be undone.`,
                              )
                            )
                              return;
                            act("rollback", { sourceRunId: run.id });
                          }}
                        >
                          {isLoading("rollback") ? "Reverting…" : "Revert this run"}
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
