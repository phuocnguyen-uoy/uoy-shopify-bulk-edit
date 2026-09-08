import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.shop.deleteMany({ where: { domain: shop } }),
  ]);
  return new Response();
};
