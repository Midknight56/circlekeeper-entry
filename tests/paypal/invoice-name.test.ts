import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PayPal } from "../../src/paypal/client";
import { createInvoice } from "../../src/paypal/invoices";
import { fakePayPal } from "../helpers/fake-paypal";

describe("invoice seller name", () => {
  beforeEach(async () => {
    PayPal.resetMemory();
    for (const k of (await env.CK.list({ prefix: "pp:token" })).keys) await env.CK.delete(k.name);
  });

  // PayPal's payer page shows the sandbox merchant's own name ("Test Store") unless the invoice names the seller.
  it("names Circlekeeper as the seller", async () => {
    const fake = fakePayPal({ "POST /v2/invoicing/invoices": () => Response.json({ id: "INV2-A" }, { status: 201 }) });
    const pp = new PayPal({ ...env, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }, fake.fetchFn, () => Date.now(), async () => {});
    await createInvoice(pp, {
      number: "CK-x-1-1", invoicerEmail: "m@example.com", recipientEmail: "r@example.com", recipientName: "Dana Lee",
      cents: 10000, dueDate: "2026-12-10", itemName: "Circle share", note: "n",
    }, "req-1");
    const sent = fake.calls("POST /v2/invoicing/invoices")[0];
    expect(sent.body.invoicer.business_name).toBe("Circlekeeper");
    expect(JSON.stringify(sent.body)).not.toMatch(/sandbox/i);
  });
});
