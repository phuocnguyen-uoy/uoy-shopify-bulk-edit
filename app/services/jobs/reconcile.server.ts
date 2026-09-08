import type { RunStatus } from "@prisma/client";
import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { tenantDb } from "../tenant.server";
import { summarizeJsonl } from "./result-stream";

type GraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type BulkOperation = {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string;
  fileSize: string | null;
  url: string | null;
  partialDataUrl: string | null;
};

async function fetchOperation(admin: GraphqlClient, id: string) {
  const response = await admin.graphql(`#graphql
    query BulkOperationStatus($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id status errorCode objectCount fileSize url partialDataUrl
        }
      }
    }`, { variables: { id } });
  if (!response.ok) throw new Error(`Bulk operation query failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: { node?: BulkOperation }; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(body.errors.map((item) => item.message).join("; "));
  if (!body.data?.node) throw new Error(`Bulk operation not found: ${id}`);
  return body.data.node;
}

function safeResultUrl(raw: string) {
  const url = new URL(raw);
  const allowed = url.hostname.endsWith(".googleapis.com")
    || url.hostname.endsWith(".shopify.com")
    || url.hostname.endsWith(".shopifycdn.com");
  if (url.protocol !== "https:" || !allowed) throw new Error("Untrusted bulk result URL");
  return url;
}

async function resultSummary(operation: BulkOperation) {
  const rawUrl = operation.url ?? operation.partialDataUrl;
  if (!rawUrl) {
    return { rows: Number(operation.objectCount), succeeded: Number(operation.objectCount), failed: 0, errors: [] };
  }
  const response = await fetch(safeResultUrl(rawUrl));
  if (!response.ok || !response.body) {
    throw new Error(`Bulk result download failed with HTTP ${response.status}`);
  }
  return summarizeJsonl(response.body);
}

function terminalStatus(status: string): RunStatus | null {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "CANCELED") return "CANCELLED";
  if (status === "FAILED" || status === "EXPIRED") return "FAILED";
  return null;
}

export async function reconcileRun(shopDomain: string, runId: string) {
  const scoped = tenantDb(db, shopDomain);
  const run = await scoped.taskRun.findUnique(runId);
  if (!run || run.status !== "RUNNING" || !run.shopifyOperationId) return null;

  const { admin } = await unauthenticated.admin(scoped.shopDomain);
  const operation = await fetchOperation(admin, run.shopifyOperationId);
  const mapped = terminalStatus(operation.status);
  if (!mapped) return { status: operation.status, changed: false };

  const summary = await resultSummary(operation);
  const finalStatus = mapped === "COMPLETED" && summary.failed > 0
    ? "PARTIALLY_FAILED"
    : mapped;
  const updated = await scoped.taskRun.reconcileOperation(
    run.id,
    operation.id,
    {
      status: finalStatus,
      stats: summary,
      error: operation.errorCode ? { code: operation.errorCode } : undefined,
      completedAt: new Date(),
    },
  );
  return { status: finalStatus, changed: updated.count === 1, summary };
}

// Privileged system scan of operation identifiers only; reconciliation itself
// is authenticated per shop and all writes are tenant-scoped.
export async function reconcileRunningRuns(limit = 25) {
  const runs = await db.taskRun.findMany({
    where: { status: "RUNNING", shopifyOperationId: { not: null } },
    orderBy: { startedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, shopDomain: true },
  });
  return Promise.allSettled(runs.map((run) => reconcileRun(run.shopDomain, run.id)));
}
