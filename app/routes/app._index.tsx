import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { tenantDb } from "../services/tenant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const tasks = await tenantDb(db, session.shop).task.listDashboard();
  return {
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

export default function Home() {
  const { activeTasks } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Bulk product editor" inlineSize="large">
      <s-button slot="primary-action" href="/app/tasks/new" variant="primary">
        New bulk edit
      </s-button>
      <s-section heading="Start a bulk edit">
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
