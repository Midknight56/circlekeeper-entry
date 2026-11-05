import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PayPal } from "../../src/paypal/client";
import { fakePayPal } from "../helpers/fake-paypal";

const ppEnv = () => ({ ...env, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });

describe("PayPal token", () => {
  beforeEach(async () => {
    PayPal.resetMemory();
    for (const k of (await env.CK.list({ prefix: "pp:token" })).keys) await env.CK.delete(k.name);
  });

  it("one token fetch serves calls until expires_in minus 300 s", async () => {
    let now = 1_000_000_000_000;
    const fake = fakePayPal({ "GET /v1/payments/payouts/{id}": () => Response.json({ ok: 1 }) }, { expiresIn: 3600 });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => now, async () => {});
    await pp.request("GET", "/v1/payments/payouts/A");
    now += 3000 * 1000; // 3,000 s later: still inside 3,600 - 300
    await pp.request("GET", "/v1/payments/payouts/B");
    expect(fake.tokenCount).toBe(1);
    now += 400 * 1000; // 3,400 s: past 3,300
    await pp.request("GET", "/v1/payments/payouts/C");
    expect(fake.tokenCount).toBe(2);
  });

  it("a 401 re-mints the token once and retries", async () => {
    let first = true;
    const fake = fakePayPal({
      "GET /v1/payments/payouts/{id}": (s) => {
        if (first) {
          first = false;
          return Response.json({ name: "AUTHENTICATION_FAILURE", debug_id: "d1" }, { status: 401 });
        }
        return Response.json({ seen: s.headers.authorization });
      },
    });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    const res = await pp.request("GET", "/v1/payments/payouts/A");
    expect(res.status).toBe(200);
    expect(fake.tokenCount).toBe(2);
    expect(res.body.seen).toBe("Bearer tok-2");
  });

  it("a second 401 is returned, not looped", async () => {
    const fake = fakePayPal({
      "GET /v1/payments/payouts/{id}": () => Response.json({ name: "AUTHENTICATION_FAILURE" }, { status: 401 }),
    });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    const res = await pp.request("GET", "/v1/payments/payouts/A");
    expect(res.status).toBe(401);
    expect(fake.tokenCount).toBe(2);
  });
});

describe("two PayPal apps", () => {
  beforeEach(async () => {
    PayPal.resetMemory();
  });

  it("each app keeps its own token; one never sends the other's", async () => {
    const fakeA = fakePayPal({ "GET /v1/payments/payouts/{id}": (s) => Response.json({ seen: s.headers.authorization }) });
    const fakeB = fakePayPal({ "GET /v1/payments/payouts/{id}": (s) => Response.json({ seen: s.headers.authorization }) });
    const a = new PayPal({ ...env, PAYPAL_CLIENT_ID: "app-a", PAYPAL_CLIENT_SECRET: "s" }, fakeA.fetchFn, () => Date.now(), async () => {});
    const b = new PayPal({ ...env, PAYPAL_CLIENT_ID: "app-b", PAYPAL_CLIENT_SECRET: "s" }, fakeB.fetchFn, () => Date.now(), async () => {});
    await a.request("GET", "/v1/payments/payouts/X");
    const rb = await b.request("GET", "/v1/payments/payouts/X");
    expect(fakeA.tokenCount).toBe(1);
    expect(fakeB.tokenCount).toBe(1);
    expect(rb.body.seen).toBe("Bearer tok-1");
    const ra = await a.request("GET", "/v1/payments/payouts/Y");
    expect(fakeA.tokenCount).toBe(1);
    expect(ra.body.seen).toBe("Bearer tok-1");
  });
});

describe("a token minted before a feature was switched on", () => {
  beforeEach(async () => {
    PayPal.resetMemory();
    for (const k of (await env.CK.list({ prefix: "pp:token" })).keys) await env.CK.delete(k.name);
  });

  it("a 403 NOT_AUTHORIZED re-mints the token once and retries", async () => {
    const fake = fakePayPal({
      "POST /v2/invoicing/invoices": (s) =>
        s.headers.authorization === "Bearer tok-1"
          ? Response.json({ name: "NOT_AUTHORIZED", debug_id: "d403" }, { status: 403 })
          : Response.json({ id: "INV2-NEW" }, { status: 201 }),
    });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    const res = await pp.request("POST", "/v2/invoicing/invoices", {});
    expect(res.status).toBe(201);
    expect(fake.tokenCount).toBe(2);
  });

  it("a second 403 is returned, not looped", async () => {
    const fake = fakePayPal({ "POST /v2/invoicing/invoices": () => Response.json({ name: "NOT_AUTHORIZED" }, { status: 403 }) });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    const res = await pp.request("POST", "/v2/invoicing/invoices", {});
    expect(res.status).toBe(403);
    expect(fake.tokenCount).toBe(2);
  });
});
