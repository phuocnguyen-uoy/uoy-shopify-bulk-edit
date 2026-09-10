import type { LoaderFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { tenantDb } from "../services/tenant.server";

function gidToAdminUrl(shop: string, gid: string, productGid?: string | null): string {
  const parts = gid.split("/");
  const id = parts[parts.length - 1];
  const type = parts[parts.length - 2];
  if (type === "Product") return `https://${shop}/admin/products/${id}`;
  if (type === "Collection") return `https://${shop}/admin/collections/${id}`;
  if (type === "ProductVariant") {
    const productId = productGid ? productGid.split("/").pop() : null;
    return productId ? `https://${shop}/admin/products/${productId}` : `https://${shop}/admin/products`;
  }
  return `https://${shop}/admin/products`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  if (!runId) return Response.json({ items: [] });

  const run = await tenantDb(db, session.shop).taskRun.findRunDetail(runId);
  if (!run) return Response.json({ items: [] });

  const labels = new Map<
    string,
    { title: string; productTitle?: string; imageUrl?: string; productGid?: string }
  >();

  if (run.changes.length > 0) {
    const response = await admin.graphql(
      `#graphql
      query RunChangedProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title featuredImage { url } }
          ... on Collection { id title image { url } }
          ... on ProductVariant {
            id title image { url }
            product { id title featuredImage { url } }
          }
        }
      }`,
      { variables: { ids: run.changes.map((c) => c.resourceGid) } },
    );
    if (response.ok) {
      const body = (await response.json()) as {
        data?: {
          nodes?: Array<{
            id: string;
            title: string;
            featuredImage?: { url: string } | null;
            image?: { url: string } | null;
            product?: { id: string; title: string; featuredImage?: { url: string } | null };
          } | null>;
        };
      };
      for (const node of body.data?.nodes ?? []) {
        if (node) {
          labels.set(node.id, {
            title: node.title,
            productTitle: node.product?.title,
            imageUrl: node.image?.url ?? node.featuredImage?.url ?? node.product?.featuredImage?.url,
            productGid: node.product?.id,
          });
        }
      }
    }
  }

  return Response.json({
    items: run.changes.map((c) => {
      const label = labels.get(c.resourceGid);
      return {
        id: c.id,
        name: [label?.productTitle, label?.title].filter(Boolean).join(" — ")
          || c.resourceGid.split("/").slice(-2).join(" "),
        imageUrl: label?.imageUrl ?? null,
        adminUrl: gidToAdminUrl(session.shop, c.resourceGid, label?.productGid),
      };
    }),
  });
};
