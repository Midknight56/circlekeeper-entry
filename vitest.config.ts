import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  publicDir: false,
  plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          PAYPAL_CLIENT_ID: "test-id",
          PAYPAL_CLIENT_SECRET: "test-secret",
          PAYPAL_WEBHOOK_ID: "WH-TEST",
          // Tests must not depend on a developer's .dev.vars: local only caps and live answers are switched off here.
          LOCAL_CIRCLE_CAP: "",
          LOCAL_AI_CAP: "",
          LOCAL_PAYPAL_WRITE_CAP: "",
          LOCAL_PAYOUT_CAP_CENTS: "",
          LOCAL_POT_CLIENT_ID: "",
          LOCAL_POT_CLIENT_SECRET: "",
          LOCAL_POT_SEND_CENTS: "",
          LOCAL_LIVE_POT_CAP: "",
          LIVE_AI: "0",
          DEV_ROUTES: "0",
          PAYPAL_PERSONAS: JSON.stringify({ merchant: "merchant@test", members: ["m1@test", "m2@test", "m3@test", "m4@test", "m5@test", "m6@test"] }),
        },
      },
    })],
  test: { include: ["tests/**/*.test.ts"] },
});
