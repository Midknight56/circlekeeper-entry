import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PayPal } from "../../src/paypal/client";
import { handleWebhook } from "../../src/paypal/webhooks";

// A raw body with odd spacing and key order: re-serialising it would change the bytes.
const RAW = '{ "id":"WH-1",  "event_type" : "PAYMENT.PAYOUTSBATCH.SUCCESS","resource":{"batch_header":{"payout_batch_id":"B1"}} }';

function signedHeaders(): Headers {
  return new Headers({
    "content-type": "application/json",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "T-1",
    "paypal-transmission-sig": "SIG-1",
    "paypal-transmission-time": "2026-10-22T23:00:00Z",
  });
}

function fakePayPal(verdict: string) {
  const sent: { url: string; body: string }[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    sent.push({ url, body });
    if (url.endsWith("/v1/oauth2/token")) {
      return Response.json({ access_token: "tok", expires_in: 32400 });
    }
    if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
      return Response.json({ verification_status: verdict });
    }
    return new Response("unexpected", { status: 500 });
  };
  const testEnv = { ...env, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_WEBHOOK_ID: "WH-OURS" };
  return { pp: new PayPal(testEnv, fetchFn as typeof fetch), sent, testEnv };
}

async function stateKeys(): Promise<string[]> {
  const list = await env.CK.list();
  return list.keys.map((k) => k.name).filter((n) => !n.startsWith("pp:token"));
}

describe("webhook signature verify", () => {
  it("refuses an event whose verify call says FAILURE, and writes nothing", async () => {
    const { pp, testEnv } = fakePayPal("FAILURE");
    let processed = 0;
    const ctx = createExecutionContext();
    const res = await handleWebhook(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: signedHeaders(), body: RAW }),
      testEnv,
      ctx,
      pp,
      async () => {
        processed++;
      },
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(processed).toBe(0);
    expect(await stateKeys()).toEqual([]);
  });

  it("sends the raw body to verify byte for byte", async () => {
    const { pp, sent, testEnv } = fakePayPal("SUCCESS");
    const ctx = createExecutionContext();
    await handleWebhook(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: signedHeaders(), body: RAW }),
      testEnv,
      ctx,
      pp,
      async () => {},
    );
    await waitOnExecutionContext(ctx);
    const verify = sent.find((s) => s.url.endsWith("/v1/notifications/verify-webhook-signature"));
    expect(verify).toBeDefined();
    expect(verify!.body).toContain('"webhook_event":' + RAW);
    const parsed = JSON.parse(verify!.body);
    expect(parsed.webhook_id).toBe("WH-OURS");
    expect(parsed.transmission_id).toBe("T-1");
    expect(parsed.auth_algo).toBe("SHA256withRSA");
  });

  it("answers 200 and processes a verified event once", async () => {
    const { pp, testEnv } = fakePayPal("SUCCESS");
    const seen: string[] = [];
    const ctx = createExecutionContext();
    const res = await handleWebhook(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: signedHeaders(), body: RAW }),
      testEnv,
      ctx,
      pp,
      async (evt) => {
        seen.push(evt.id);
      },
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["WH-1"]);
  });

  it("refuses a delivery with no PayPal signature headers without calling PayPal", async () => {
    const { pp, sent, testEnv } = fakePayPal("SUCCESS");
    const ctx = createExecutionContext();
    const res = await handleWebhook(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", body: RAW }),
      testEnv,
      ctx,
      pp,
      async () => {},
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(sent.length).toBe(0);
  });
});

describe("two webhooks, one per PayPal app", () => {
  it("an event signed for the payout app's webhook is accepted by its own verifier", async () => {
    const first = fakePayPal("FAILURE");
    const second = fakePayPal("SUCCESS");
    const seen: string[] = [];
    const ctx = createExecutionContext();
    const res = await handleWebhook(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: signedHeaders(), body: RAW }),
      first.testEnv,
      ctx,
      first.pp,
      async (evt) => {
        seen.push(evt.id);
      },
      [{ pp: second.pp, webhookId: "WH-PAYOUT" }],
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["WH-1"]);
    const sentToSecond = second.sent.find((s) => s.url.endsWith("/v1/notifications/verify-webhook-signature"))!;
    expect(JSON.parse(sentToSecond.body).webhook_id).toBe("WH-PAYOUT");
  });
});
