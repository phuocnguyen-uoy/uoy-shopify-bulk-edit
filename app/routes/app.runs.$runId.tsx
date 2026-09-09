import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { tenantDb } from "../services/tenant.server";

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  descriptionHtml: "Description",
  vendor: "Vendor",
  productType: "Product type",
  status: "Status",
  tags: "Tags",
  handle: "Handle",
  templateSuffix: "Template suffix",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  variantPrice: "Price",
  variantCompareAtPrice: "Compare at price",
  variantSku: "SKU",
  variantBarcode: "Barcode",
  variantTaxable: "Taxable",
  variantInventoryPolicy: "Inventory policy",
};

function fmtValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return val.length > 0 ? val.join(", ") : "(empty)";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  const s = String(val);
  return s === "" ? "(empty)" : s;
}

function gidLabel(gid: string) {
  // gid://shopify/Product/12345678 → "Product 12345678"
  const match = /\/([A-Za-z]+)\/(\d+)$/.exec(gid);
  if (!match) return gid;
  return `${match[1]} ${match[2]}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!params.runId) throw new Response("Run id is required", { status: 400 });
  const run = await tenantDb(db, session.shop).taskRun.findRunDetail(
    params.runId,
  );
  if (!run) throw new Response("Run not found", { status: 404 });

  const resourceLabels = new Map<
    string,
    { title: string; productTitle?: string; imageUrl?: string }
  >();
  if (run.changes.length > 0) {
    const response = await admin.graphql(
      `#graphql
      query ChangedResourceLabels($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title featuredImage { url } }
          ... on Collection { id title image { url } }
          ... on ProductVariant {
            id
            title
            image { url }
            product { title featuredImage { url } }
          }
        }
      }`,
      { variables: { ids: run.changes.map((change) => change.resourceGid) } },
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
          resourceLabels.set(node.id, {
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

  // Collect all unique changed fields (for table columns)
  const allFields = [
    ...new Set(run.changes.flatMap((c) => Object.keys(c.before as Record<string, unknown>))),
  ];

  return {
    run: {
      id: run.id,
      taskName: run.task.name,
      taskId: run.task.id,
      kind: run.kind,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    },
    fields: allFields,
    changes: run.changes.map((c) => {
      const resource = resourceLabels.get(c.resourceGid);
      const before = c.before as Record<string, unknown>;
      const after = c.after as Record<string, unknown>;
      return {
        id: c.id,
        label: resource
          ? [resource.productTitle, resource.title].filter(Boolean).join(" — ")
          : gidLabel(c.resourceGid),
        resourceType: c.resourceType,
        imageUrl: resource?.imageUrl,
        conflictStatus: c.conflictStatus,
        before,
        after,
      };
    }),
  };
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

const CONFLICT_TONE: Record<string, BadgeTone> = {
  NONE: "neutral",
  DETECTED: "caution",
  SKIPPED: "warning",
  FORCE_APPLIED: "critical",
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

export default function RunDetail() {
  const { run, fields, changes } = useLoaderData<typeof loader>();

  return (
    <s-page
      heading={`${run.kind === "REVERT" ? "Revert" : "Bulk edit"} — ${run.taskName}`}
      inlineSize="large"
    >
      <s-button slot="secondary-actions" href="/app/history">
        Back to history
      </s-button>
      <s-button slot="secondary-actions" href={`/app/tasks/${run.taskId}`}>
        View task
      </s-button>

      <s-stack direction="block" gap="large">
        <s-section heading="Run summary">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small">
              <s-badge tone={run.kind === "REVERT" ? "warning" : "neutral"}>
                {run.kind === "REVERT" ? "Revert" : "Bulk edit"}
              </s-badge>
              <s-badge tone={STATUS_TONE[run.status] ?? "neutral"}>
                {run.status.toLowerCase().replace(/_/g, " ")}
              </s-badge>
            </s-stack>
            <s-text>Started: {fmtDate(run.createdAt)}</s-text>
            {run.completedAt && (
              <s-text>Completed: {fmtDate(run.completedAt)}</s-text>
            )}
            <s-text>
              {changes.length} {changes.length === 1 ? "item" : "items"} changed
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Changed items">
          {changes.length === 0 ? (
            <s-paragraph>No item changes recorded for this run.</s-paragraph>
          ) : (() => {
            const gridCols = `2fr ${fields.map(() => "1fr").join(" ")}`;
            return (
              <div style={{ border: "1px solid #d1d1d1", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: 12, background: "#f7f7f7" }}>
                  <s-grid gridTemplateColumns={gridCols} gap="base">
                    <s-text type="strong">Resource</s-text>
                    {fields.map((field) => (
                      <s-text key={field} type="strong">
                        {FIELD_LABEL[field] ?? field}
                      </s-text>
                    ))}
                  </s-grid>
                </div>
                {changes.map((change) => (
                  <div key={change.id} style={{ padding: 12, borderTop: "1px solid #e3e3e3" }}>
                    <s-grid gridTemplateColumns={gridCols} gap="base">
                      <s-stack direction="inline" gap="small">
                        {change.imageUrl && (
                          <img
                            src={change.imageUrl}
                            alt=""
                            width={40}
                            height={40}
                            style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                          />
                        )}
                        <s-stack direction="block" gap="small">
                          <s-text type="strong">{change.label}</s-text>
                          <s-stack direction="inline" gap="small">
                            <s-badge tone="neutral">
                              {change.resourceType.toLowerCase()}
                            </s-badge>
                            {change.conflictStatus !== "NONE" && (
                              <s-badge tone={CONFLICT_TONE[change.conflictStatus] ?? "neutral"}>
                                {change.conflictStatus.toLowerCase().replace(/_/g, " ")}
                              </s-badge>
                            )}
                          </s-stack>
                        </s-stack>
                      </s-stack>
                      {fields.map((field) => (
                        <div key={field}>
                          {field in change.before || field in change.after ? (
                            <s-stack direction="block" gap="small">
                              <s-text>{fmtValue(change.before[field])}</s-text>
                              <s-text>→ {fmtValue(change.after[field])}</s-text>
                            </s-stack>
                          ) : (
                            <s-text>—</s-text>
                          )}
                        </div>
                      ))}
                    </s-grid>
                  </div>
                ))}
              </div>
            );
          })()}
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
