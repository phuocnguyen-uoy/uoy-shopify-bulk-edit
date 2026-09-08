import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  // This MVP stores catalog task data only and does not persist customer data.
  return new Response();
};
