import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker";
import { fakePayPal } from "../helpers/fake-paypal";

// Keep unusual whitespace and key spacing so byte changes are visible in the verify payload.
const RAW = '{ "id":"WH-POT-1",  "event_type" : "POT.DOOR.TEST","resource":{"value":  7} }';

function signedHeaders(): Headers {
  return new Headers({
    "content-type": "application/json",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-POT",
    "paypal-transmission-id": "T-POT-1",
    "paypal-transmission-sig": "SIG-POT-1",
    "paypal-transmission-time": "2026-10-22T23:00:00Z",
  });
}

async function deliver(testEnv: typeof env): Promise<{ status: number; sent: ReturnType<typeof fakePayPal>["sent"] }> {
  const originalFetch = globalThis.fetch;
  const paypal = fakePayPal({
    "POST /v1/notifications/verify-webhook-signature": (s) =>
      Response.json({ verification_status: s.body.webhook_id === "WH-PAYOUT-POT" ? "SUCCESS" : "FAILURE" }),
  });
  try {
    globalThis.fetch = paypal.fetchFn;
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: signedHeaders(), body: RAW }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: response.status, sent: paypal.sent };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("PayPal pot door through the Worker", () => {
  it("accepts an event verified by the payout app after the main app says FAILURE", async () => {
    const testEnv = {
      ...env,
      PAYPAL_PAYOUT_CLIENT_ID: "payout-pot-client",
      PAYPAL_PAYOUT_CLIENT_SECRET: "payout-pot-secret",
      PAYPAL_PAYOUT_WEBHOOK_ID: "WH-PAYOUT-POT",
    };

    const { status, sent } = await deliver(testEnv);

    expect(status).toBe(200);
    expect(sent.some((s) => s.path === "/v1/notifications/verify-webhook-signature" && s.body.webhook_id === "WH-PAYOUT-POT")).toBe(true);
    expect(sent.some((s) =>
      s.path === "/v1/oauth2/token" &&
      s.headers.authorization === "Basic " + btoa("payout-pot-client:payout-pot-secret"),
    )).toBe(true);
  });

  it("refuses the event when payout app keys are not configured", async () => {
    const { PAYPAL_PAYOUT_CLIENT_ID: _clientId, PAYPAL_PAYOUT_CLIENT_SECRET: _clientSecret, PAYPAL_PAYOUT_WEBHOOK_ID: _webhookId, ...withoutPayout } = env;

    expect((await deliver(withoutPayout)).status).toBe(400);
  });

  it("sends the payout webhook ID and unchanged raw event body to verification", async () => {
    const sent = fakePayPal({
      "POST /v1/notifications/verify-webhook-signature": (s) =>
        Response.json({ verification_status: s.body.webhook_id === "WH-PAYOUT-POT" ? "SUCCESS" : "FAILURE" }),
    });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = sent.fetchFn;
      const testEnv = {
        ...env,
        PAYPAL_PAYOUT_CLIENT_ID: "raw-payout-app-client",
        PAYPAL_PAYOUT_CLIENT_SECRET: "payout-pot-secret-raw",
        PAYPAL_PAYOUT_WEBHOOK_ID: "WH-PAYOUT-POT",
      };
      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: signedHeaders(), body: RAW }),
        testEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const verify = sent.calls("POST /v1/notifications/verify-webhook-signature").find((s) => s.body.webhook_id === "WH-PAYOUT-POT");
      expect(verify).toBeDefined();
      expect(verify!.raw).toContain('"webhook_event":' + RAW);
      expect(verify!.body.webhook_id).toBe("WH-PAYOUT-POT");

      const payoutToken = sent.calls("POST /v1/oauth2/token").find((s) =>
        s.headers.authorization === "Basic " + btoa("raw-payout-app-client:payout-pot-secret-raw"),
      );
      expect(payoutToken).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
