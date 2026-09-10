import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import { rollbackSkippedCount } from "../services/jobs/rollback-conflict";
import { executeRun } from "../services/jobs/execute.server";
import { reconcileRun } from "../services/jobs/reconcile.server";
import { enqueueRollback } from "../services/tasks/task-service.server";
import { tenantDb } from "../services/tenant.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const scoped = tenantDb(db, session.shop);
  let runs = await scoped.taskRun.listHistory();
  const running = runs.filter((run) => run.status === "RUNNING").slice(0, 10);
  if (running.length > 0) {
    await Promise.allSettled(
      running.map((run) => reconcileRun(session.shop, run.id)),
    );
    runs = await scoped.taskRun.listHistory();
  }

  return {
    runs: runs.map((run) => ({
      id: run.id,
      taskId: run.task.id,
      taskName: run.task.name,
      resourceType: run.task.resourceType,
      kind: run.kind,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      changeCount: run._count.changes,
      skippedCount: rollbackSkippedCount(run.error, run.stats),
      canRevert: run.kind === "APPLY" && run.status === "COMPLETED",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const taskId = String(form.get("taskId") ?? "");
  const sourceRunId = String(form.get("sourceRunId") ?? "");
  if (!taskId || !sourceRunId) {
    throw new Response("Task and source run are required", { status: 422 });
  }
  const run = await enqueueRollback(session.shop, taskId, sourceRunId);
  try {
    await executeRun(session.shop, run.id);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Revert failed",
      sourceRunId,
    };
  }
  return redirect("/app/history");
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

const COLS = "2fr 0.8fr 1fr 0.7fr 1.2fr 1.2fr 0.7fr";

export default function TaskHistory() {
  const { runs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busy = navigation.state !== "idle";
  const revertingRunId = navigation.formData?.get("sourceRunId") as string | null;

  const revertError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <s-page heading="Task history" inlineSize="large">
      <s-button slot="primary-action" href="/app/tasks/new" variant="primary">
        New bulk edit
      </s-button>
      {revertError && (
        <s-banner tone="critical" heading="Revert failed">
          <s-paragraph>{revertError}</s-paragraph>
          <s-paragraph>A resource may have been changed after the bulk edit ran. Please check the current values and revert manually if needed.</s-paragraph>
        </s-banner>
      )}
      <s-section heading="Bulk edit runs">
        {runs.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No bulk edits have run yet.</s-paragraph>
            <s-button href="/app/tasks/new">
              Create your first bulk edit
            </s-button>
          </s-stack>
        ) : (
          <div
            style={{
              border: "1px solid #d1d1d1",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 12, background: "#f7f7f7" }}>
              <s-grid gridTemplateColumns={COLS} gap="base">
                <s-text type="strong">Task</s-text>
                <s-text type="strong">Type</s-text>
                <s-text type="strong">Status</s-text>
                <s-text type="strong">Resources</s-text>
                <s-text type="strong">Started</s-text>
                <s-text type="strong">Completed</s-text>
                <s-text type="strong">Action</s-text>
              </s-grid>
            </div>
            {runs.map((run) => (
              <div
                key={run.id}
                style={{ padding: 12, borderTop: "1px solid #e3e3e3" }}
              >
                <s-grid gridTemplateColumns={COLS} gap="base">
                  <s-link href={`/app/tasks/${run.taskId}`}>
                    {run.taskName}
                  </s-link>
                  <s-text>
                    {run.kind === "REVERT" ? "Revert" : "Bulk edit"}
                  </s-text>
                  <s-stack direction="block" gap="small">
                    <s-badge tone={STATUS_TONE[run.status] ?? "neutral"}>
                      {run.status.toLowerCase().replace(/_/g, " ")}
                    </s-badge>
                    {run.skippedCount > 0 && (
                      <s-text>{run.skippedCount} skipped: current values changed; not reverted.</s-text>
                    )}
                  </s-stack>
                  <s-text>{run.changeCount > 0 ? run.changeCount : "—"}</s-text>
                  <s-text>{fmtDate(run.createdAt)}</s-text>
                  <s-text>
                    {run.completedAt ? fmtDate(run.completedAt) : "—"}
                  </s-text>
                  <s-stack direction="inline" gap="small">
                  {run.canRevert && (
                    <s-button
                      type="button"
                      tone="critical"
                      disabled={busy}
                      loading={revertingRunId === run.id}
                      onClick={() => {
                        if (!window.confirm(`Revert this run? All ${run.resourceType === "COLLECTION" ? "collection" : "product"} changes that still match this run will be undone. Conflicting resources will be skipped.`)) return;
                        const data = new FormData();
                        data.set("taskId", run.taskId);
                        data.set("sourceRunId", run.id);
                        submit(data, { method: "post" });
                      }}
                    >
                      {revertingRunId === run.id ? "Reverting…" : "Revert"}
                    </s-button>
                  )}
                  </s-stack>
                </s-grid>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
