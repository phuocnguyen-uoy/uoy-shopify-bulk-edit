import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.shop.updateMany({
      where: { domain: shop },
      data: { uninstalledAt: new Date() },
    }),
  ]);

  return new Response();
};
