import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { tenantDb } from "../services/tenant.server";
import { reconcileRun } from "../services/jobs/reconcile.server";
import db from "../db.server";

// Polling status endpoint used by useFetcher in the task detail page.
// Reconciles any RUNNING runs against Shopify then returns updated statuses —
// keeping navigation fast (no reconcile in the main loader) while still
// surfacing progress every 2 s without a full page reload.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!params.taskId) return Response.json({ runs: [] });

  const scoped = tenantDb(db, session.shop);
  const task = await scoped.task.findDetail(params.taskId);
  if (!task) return Response.json({ runs: [] });

  const runningRuns = task.runs.filter((run) => run.status === "RUNNING");
  if (runningRuns.length > 0) {
    await Promise.allSettled(
      runningRuns.map((run) => reconcileRun(session.shop, run.id)),
    );
  }

  const refreshed =
    runningRuns.length > 0
      ? await scoped.task.findDetail(params.taskId)
      : task;

  return Response.json({
    runs: (refreshed?.runs ?? task.runs).map((run) => ({
      id: run.id,
      kind: run.kind,
      status: run.status,
      scheduledFor: run.scheduledFor.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      changeCount: run._count.changes,
      canRollback: run.kind === "APPLY" && run.status === "COMPLETED",
      stats: run.stats as { totalCount?: number; processedCount?: number } | null,
    })),
  });
};
