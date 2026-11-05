import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PayPal } from "../../src/paypal/client";
import { fakePayPal } from "../helpers/fake-paypal";

const ppEnv = () => ({ ...env, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });

describe("PayPal-Request-Id", () => {
  beforeEach(async () => {
    PayPal.resetMemory();
    for (const k of (await env.CK.list({ prefix: "pp:token" })).keys) await env.CK.delete(k.name);
  });

  it("every POST carries one, and GETs do not", async () => {
    const fake = fakePayPal({
      "POST /v2/invoicing/invoices": () => Response.json({ id: "INV2-A" }, { status: 201 }),
      "GET /v2/invoicing/invoices/{id}": () => Response.json({ status: "SENT" }),
    });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    await pp.request("POST", "/v2/invoicing/invoices", { a: 1 });
    await pp.request("POST", "/v2/invoicing/invoices", { a: 2 });
    await pp.request("GET", "/v2/invoicing/invoices/INV2-A");
    const posts = fake.calls("POST /v2/invoicing/invoices");
    expect(posts.length).toBe(2);
    for (const p of posts) expect(p.headers["paypal-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[0].headers["paypal-request-id"]).not.toBe(posts[1].headers["paypal-request-id"]);
    expect(fake.calls("GET /v2/invoicing/invoices/INV2-A")[0].headers["paypal-request-id"]).toBeUndefined();
  });

  it("a retry after a 503 reuses the same id", async () => {
    let n = 0;
    const fake = fakePayPal({
      "POST /v1/payments/payouts": () =>
        ++n === 1
          ? Response.json({ name: "SERVICE_UNAVAILABLE" }, { status: 503 })
          : Response.json({ ok: 1 }, { status: 201 }),
    });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    const res = await pp.request("POST", "/v1/payments/payouts", { x: 1 });
    expect(res.status).toBe(201);
    const posts = fake.calls("POST /v1/payments/payouts");
    expect(posts.length).toBe(2);
    expect(posts[0].headers["paypal-request-id"]).toBe(posts[1].headers["paypal-request-id"]);
  });

  it("a caller's stored id is used as given", async () => {
    const fake = fakePayPal({ "POST /v1/payments/payouts": () => Response.json({}, { status: 201 }) });
    const pp = new PayPal(ppEnv(), fake.fetchFn, () => Date.now(), async () => {});
    await pp.request("POST", "/v1/payments/payouts", {}, { requestId: "ck-stored-1" });
    expect(fake.calls("POST /v1/payments/payouts")[0].headers["paypal-request-id"]).toBe("ck-stored-1");
  });
});
