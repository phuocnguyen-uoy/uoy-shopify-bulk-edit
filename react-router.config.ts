import type { Config } from "@react-router/dev/config";

const appUrl = new URL(
  process.env.SHOPIFY_APP_URL || "https://uoy-bulk-product-editor.onrender.com",
);
if (!["http:", "https:"].includes(appUrl.protocol) || appUrl.hostname.includes("*")) {
  throw new Error("SHOPIFY_APP_URL must be an HTTP(S) URL with an exact hostname");
}
const productionHost = appUrl.host;

export default {
  // Each deployment accepts actions from its own public Shopify app URL.
  allowedActionOrigins:
    process.env.NODE_ENV === "production"
      ? [productionHost]
      : [productionHost, "localhost", "*.trycloudflare.com"],
} satisfies Config;
