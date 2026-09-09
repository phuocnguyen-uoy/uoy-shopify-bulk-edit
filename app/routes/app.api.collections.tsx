import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? "";
  const ids = url.searchParams.get("ids") ?? "";

  if (ids) {
    const numericIds = ids
      .split(",")
      .map((s) => s.trim())
      .filter((id) => /^\d+$/.test(id));
    const gids = numericIds.map((id) => `gid://shopify/Collection/${id}`);
    const response = await admin.graphql(
      `#graphql
      query FetchCollectionsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Collection {
            id
            title
            handle
          }
        }
      }`,
      { variables: { ids: gids } },
    );
    if (!response.ok) {
      return Response.json({ collections: [], error: "Unable to load selected collections" }, { status: 502 });
    }
    const body = (await response.json()) as {
      data?: { nodes?: Array<{ id: string; title: string; handle: string } | null> };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      return Response.json({ collections: [], error: body.errors.map((error) => error.message).join("; ") }, { status: 502 });
    }
    const collections = (body.data?.nodes ?? [])
      .filter(Boolean)
      .map((c) => ({
        id: (c!.id as string).split("/").pop() ?? c!.id,
        title: c!.title,
        handle: c!.handle,
      }));
    return Response.json({ collections });
  }

  const collections: Array<{ id: string; title: string; handle: string }> = [];
  let cursor: string | null = null;
  do {
    const response = await admin.graphql(
      `#graphql
      query FetchCollections($query: String!, $first: Int!, $after: String) {
        collections(first: $first, after: $after, query: $query, sortKey: TITLE) {
          nodes {
            id
            title
            handle
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { query, first: query ? 50 : 250, after: cursor } },
    );
    if (!response.ok) {
      return Response.json({ collections: [], error: "Unable to load collections" }, { status: 502 });
    }
    const body = (await response.json()) as {
      data?: { collections?: {
        nodes: Array<{ id: string; title: string; handle: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      } };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length || !body.data?.collections) {
      return Response.json(
        { collections: [], error: body.errors?.map((error) => error.message).join("; ") || "Unable to load collections" },
        { status: 502 },
      );
    }
    collections.push(...body.data.collections.nodes.map((collection) => ({
      id: collection.id.split("/").pop() ?? collection.id,
      title: collection.title,
      handle: collection.handle,
    })));
    cursor = !query && body.data.collections.pageInfo.hasNextPage
      ? body.data.collections.pageInfo.endCursor
      : null;
  } while (cursor);

  return Response.json({ collections });
}
