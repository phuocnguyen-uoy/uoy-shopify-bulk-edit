import type { ActionFunctionArgs } from "react-router";

import { reconcileRunningRuns } from "../services/jobs/reconcile.server";
import { executeQueuedRuns } from "../services/jobs/execute.server";
import { claimDueTasks } from "../services/scheduler/scheduler.server";

function cronAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-cron-secret");
  return Boolean(configuredSecret && suppliedSecret === configuredSecret);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!cronAuthorized(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const [claims] = await Promise.allSettled([claimDueTasks()]);
  const [execution, reconciliation] = await Promise.allSettled([
    executeQueuedRuns(),
    reconcileRunningRuns(),
  ]);
  const claimed = claims.status === "fulfilled" ? claims.value.length : 0;
  const executed = execution.status === "fulfilled"
    ? execution.value.filter((result) => result.status === "fulfilled").length
    : 0;
  const reconciled = reconciliation.status === "fulfilled"
    ? reconciliation.value.filter((result) => result.status === "fulfilled").length
    : 0;
  const failures = (claims.status === "rejected" ? 1 : 0)
    + (execution.status === "rejected" ? 1 : 0)
    + (execution.status === "fulfilled"
      ? execution.value.filter((result) => result.status === "rejected").length
      : 0)
    + (reconciliation.status === "rejected" ? 1 : 0)
    + (reconciliation.status === "fulfilled"
      ? reconciliation.value.filter((result) => result.status === "rejected").length
      : 0);

  return Response.json({ claimed, executed, reconciled, failures }, {
    status: failures > 0 ? 207 : 200,
  });
};
