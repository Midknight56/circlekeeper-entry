import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PayPal, type CallRecord } from "../../src/paypal/client";
import { fakePayPal } from "../helpers/fake-paypal";

const ppEnv = () => ({ ...env, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });

describe("debug_id", () => {
  beforeEach(async () => {
    PayPal.resetMemory();
    for (const k of (await env.CK.list({ prefix: "pp:token" })).keys) await env.CK.delete(k.name);
  });

  it("an error's debug_id and name reach the call log, and the token never does", async () => {
    const fake = fakePayPal({
      "POST /v2/invoicing/invoices": () =>
        Response.json({ name: "INVALID_REQUEST", debug_id: "abc123def", details: [] }, { status: 400 }),
    });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    const log: CallRecord[] = [];
    pp.onCall = (r) => {
      log.push(r);
    };
    const res = await pp.request("POST", "/v2/invoicing/invoices", {});
    expect(res.debugId).toBe("abc123def");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      method: "POST",
      path: "/v2/invoicing/invoices",
      status: 400,
      debugId: "abc123def",
      errorName: "INVALID_REQUEST",
    });
    expect(JSON.stringify(log)).not.toContain("tok-");
  });

  it("a 429 waits for Retry-After before the retry", async () => {
    let n = 0;
    const fake = fakePayPal({
      "GET /v1/payments/payouts/{id}": () =>
        ++n === 1
          ? new Response(JSON.stringify({ name: "RATE_LIMIT_REACHED" }), { status: 429, headers: { "retry-after": "2" } })
          : Response.json({ ok: 1 }),
    });
    const waits: number[] = [];
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async (ms) => {
      waits.push(ms);
    });
    const res = await pp.request("GET", "/v1/payments/payouts/A");
    expect(res.status).toBe(200);
    expect(waits).toEqual([2000]);
  });
});
