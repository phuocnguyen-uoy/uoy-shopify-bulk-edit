import type { Config } from "@react-router/dev/config";

const productionHost = "uoy-bulk-product-editor.onrender.com";

export default {
  // Shopify dev actions originate from the public tunnel while React Router
  // receives the request through the local proxy. Allow only our production
  // host and the dynamic Cloudflare development host pattern.
  allowedActionOrigins:
    process.env.NODE_ENV === "production"
      ? [productionHost]
      : [productionHost, "localhost", "*.trycloudflare.com"],
} satisfies Config;
