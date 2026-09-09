import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { tenantDb } from "../services/tenant.server";

const PERIOD_MS: Record<string, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: null,
};

const PERIOD_LABELS: Record<string, string> = {
  "24h": "24h",
  week: "1 Week",
  month: "1 Month",
  all: "All time",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim().toLowerCase();
  const url = new URL(request.url);
  const rawPeriod = url.searchParams.get("period") ?? "all";
  const period = rawPeriod in PERIOD_MS ? rawPeriod : "all";
  const ms = PERIOD_MS[period];
  const since = ms !== null ? new Date(Date.now() - ms) : undefined;

  const [tasks, runCounts] = await Promise.all([
    tenantDb(db, session.shop).task.listDashboard(),
    db.taskRun.groupBy({
      by: ["status"],
      where: {
        shopDomain,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { status: true },
    }),
  ]);

  const byStatus = Object.fromEntries(
    runCounts.map((r) => [r.status, r._count.status]),
  );

  return {
    period,
    stats: {
      running: byStatus["RUNNING"] ?? 0,
      pending: (byStatus["QUEUED"] ?? 0) + (byStatus["PREPARING"] ?? 0),
      completed: byStatus["COMPLETED"] ?? 0,
      failed: (byStatus["FAILED"] ?? 0) + (byStatus["PARTIALLY_FAILED"] ?? 0),
    },
    activeTasks: tasks
      .filter((task) =>
        ["QUEUED", "PREPARING", "RUNNING"].includes(task.runs[0]?.status ?? ""),
      )
      .map((task) => ({
        id: task.id,
        name: task.name,
        latestRunStatus: task.runs[0]?.status ?? null,
      })),
  };
};

const STAT_COLS = [
  { key: "running" as const, label: "Running", color: "#0070f3" },
  { key: "pending" as const, label: "Pending", color: "#e8a400" },
  { key: "completed" as const, label: "Completed", color: "#008060" },
  { key: "failed" as const, label: "Failed", color: "#d72c0d" },
];

export default function Home() {
  const { activeTasks, stats, period } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <s-page heading="Bulk product editor" inlineSize="large">
      <s-button slot="primary-action" href="/app/tasks/new" variant="primary">
        New bulk edit
      </s-button>

      <s-section heading="Create bulk edit">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Filter products, preview the matches, and safely update products
            and variants in bulk.
          </s-paragraph>
          <s-button href="/app/tasks/new" variant="primary">
            Create bulk edit
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Task overview">
        {/* Period select */}
        <div style={{ marginBottom: "1rem", maxWidth: "200px" }}>
          <s-select
            label="Time range"
            value={period}
            onChange={(e: { currentTarget: { value: string } }) =>
              navigate(`?period=${e.currentTarget.value}`)
            }
          >
            {Object.keys(PERIOD_LABELS).map((p) => (
              <s-option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </s-option>
            ))}
          </s-select>
        </div>

        {/* Stats cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            border: "1px solid #e1e3e5",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          {STAT_COLS.map(({ key, label, color }, i) => (
            <div
              key={key}
              style={{
                padding: "1.25rem 1rem",
                textAlign: "center",
                borderRight:
                  i < STAT_COLS.length - 1 ? "1px solid #e1e3e5" : "none",
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  color,
                  lineHeight: 1,
                }}
              >
                {stats[key]}
              </div>
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: "#6d7175",
                  marginTop: "0.375rem",
                  fontWeight: 500,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
        {stats.failed > 0 && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.875rem" }}>
            <s-link href="/app/history">View failed runs →</s-link>
          </div>
        )}
      </s-section>

      {activeTasks.length > 0 && (
        <s-section heading="Running now">
          <s-stack direction="block" gap="small">
            {activeTasks.map((task) => (
              <s-stack key={task.id} direction="inline" gap="small">
                <s-link href={`/app/tasks/${task.id}`}>{task.name}</s-link>
                <s-badge tone="info">
                  {(task.latestRunStatus ?? "").toLowerCase()}
                </s-badge>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
