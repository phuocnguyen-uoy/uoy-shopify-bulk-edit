import db from "../../db.server";
import { tenantDb } from "../tenant.server";
type GraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type StagedTarget = {
  url: string;
  parameters: Array<{ name: string; value: string }>;
};

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Shopify request failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function toJsonl(rows: Record<string, unknown>[]) {
  if (rows.length === 0) throw new Error("Bulk mutation input cannot be empty");
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export async function createBulkMutationUpload(admin: GraphqlClient): Promise<StagedTarget> {
  const response = await admin.graphql(`#graphql
    mutation CreateBulkMutationUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url parameters { name value } }
        userErrors { field message }
      }
    }`, {
    variables: {
      input: [{
        resource: "BULK_MUTATION_VARIABLES",
        filename: "bulk-edit.jsonl",
        mimeType: "text/jsonl",
        httpMethod: "POST",
      }],
    },
  });
  const body = await json<{ data?: { stagedUploadsCreate?: {
    stagedTargets: StagedTarget[];
    userErrors: Array<{ message: string }>;
  } } }>(response);
  const payload = body.data?.stagedUploadsCreate;
  if (!payload || payload.userErrors.length) {
    throw new Error(payload?.userErrors.map((item) => item.message).join("; ") || "Missing staged upload");
  }
  const target = payload.stagedTargets[0];
  if (!target) throw new Error("Shopify returned no staged upload target");
  return target;
}

export async function uploadJsonl(target: StagedTarget, content: string) {
  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append("file", new Blob([content], { type: "text/jsonl" }), "bulk-edit.jsonl");
  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Staged upload failed with HTTP ${response.status}`);
  const key = target.parameters.find((item) => item.name === "key")?.value;
  if (!key) throw new Error("Staged upload target is missing key");
  return key;
}

export async function runBulkMutation(
  admin: GraphqlClient,
  mutation: string,
  stagedUploadPath: string,
) {
  const response = await admin.graphql(`#graphql
    mutation RunBulkMutation($mutation: String!, $stagedUploadPath: String!) {
      bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`, { variables: { mutation, stagedUploadPath } });
  const body = await json<{ data?: { bulkOperationRunMutation?: {
    bulkOperation: { id: string; status: string } | null;
    userErrors: Array<{ message: string }>;
  } } }>(response);
  const payload = body.data?.bulkOperationRunMutation;
  if (!payload?.bulkOperation || payload.userErrors.length) {
    throw new Error(payload?.userErrors.map((item) => item.message).join("; ") || "Bulk mutation was not created");
  }
  return payload.bulkOperation;
}

async function stageAndRun(
  admin: GraphqlClient,
  mutation: string,
  rows: Record<string, unknown>[],
) {
  const target = await createBulkMutationUpload(admin);
  const stagedUploadPath = await uploadJsonl(target, toJsonl(rows));
  return runBulkMutation(admin, mutation, stagedUploadPath);
}

export const PRODUCT_UPDATE_MUTATION = `
  mutation call($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id }
      userErrors { field message }
    }
  }
`;

export const VARIANT_UPDATE_MUTATION = `
  mutation call($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      userErrors { field message }
    }
  }
`;

export async function stageAndRunForTask(
  admin: GraphqlClient,
  shopDomain: string,
  taskRunId: string,
  mutation: string,
  rows: Record<string, unknown>[],
) {
  const operation = await stageAndRun(admin, mutation, rows);
  const attached = await tenantDb(db, shopDomain).taskRun.attachShopifyOperation(
    taskRunId,
    operation.id,
  );
  if (attached.count !== 1) {
    throw new Error(
      `Bulk operation ${operation.id} started but TaskRun ${taskRunId} was not attachable`,
    );
  }
  return operation;
}
