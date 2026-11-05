import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { PayPal } from "../../src/paypal/client";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";

const headers = () => new Headers({
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-ATTACK",
  "paypal-transmission-id": "T-ATTACK",
  "paypal-transmission-sig": "SIG-ATTACK",
  "paypal-transmission-time": "2026-10-22T23:00:00Z",
});

const validEvent = (id: string, event_type: string, resource: unknown) => JSON.stringify({ id, event_type, resource });

function testPayPal(verdict: "SUCCESS" | "FAILURE" | "500" | "timeout" = "SUCCESS", existing?: ReturnType<typeof sandbox>) {
  const sb = existing ?? sandbox();
  const api = sb.fetchFn;
  const fetchFn: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/notifications/verify-webhook-signature") {
      if (verdict === "timeout") throw new Error("simulated timeout");
      if (verdict === "500") return Response.json({ name: "SERVICE_UNAVAILABLE" }, { status: 500 });
      return Response.json({ verification_status: verdict });
    }
    return api(input, init);
  };
  return { sb, fetchFn };
}

async function circle() {
  const c = draftCircle("A savings circle with Keisha, Marisol, Dana, Theo, Amelie and Sam", "2026-10-23").circle!;
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
  await stub.create(c);
  const oldFetch = globalThis.fetch;
  const { sb, fetchFn } = testPayPal();
  globalThis.fetch = fetchFn;
  try {
    const started = await stub.start("https://ck.test", c.organiserToken);
    expect(started.status).toBe(200);
  } finally {
    globalThis.fetch = oldFetch;
  }
  return { c, stub, sb };
}

async function deliver(raw: string, opts: { headers?: Headers; verdict?: "SUCCESS" | "FAILURE" | "500" | "timeout"; sb?: ReturnType<typeof sandbox> } = {}) {
  const oldFetch = globalThis.fetch;
  const { sb, fetchFn } = testPayPal(opts.verdict || "SUCCESS", opts.sb);
  globalThis.fetch = fetchFn;
  try {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://ck.test/webhooks/paypal", { method: "POST", headers: opts.headers ?? headers(), body: raw }),
      { ...env, PAYPAL_WEBHOOK_ID: "WH-ATTACK" }, ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: response.status, sb };
  } finally {
    globalThis.fetch = oldFetch;
    PayPal.resetMemory();
  }
}

async function state(stub: any, c: { organiserToken: string }) {
  const result = await stub.state("https://ck.test", c.organiserToken);
  return result.body as any;
}

afterEach(() => PayPal.resetMemory());

describe("adversarial PayPal webhooks through the Worker", () => {
  it("repeated delivery and simultaneous duplicates update a share once", async () => {
    const { c, stub, sb } = await circle();
    const invoice = (await state(stub, c)).rounds[0].shares[0].parts[0].invoiceId as string;
    sb.payInvoice(invoice);
    const raw = validEvent("WH-REPEAT", "INVOICING.INVOICE.PAID", { invoice: { id: invoice, status: "PAID" } });
    const results = await Promise.all([deliver(raw, { sb }), deliver(raw, { sb })]);
    expect(results.map((x) => x.status)).toEqual([200, 200]);
    await deliver(raw, { sb });
    const board = await state(stub, c);
    expect(board.rounds[0].shares[0].state).toBe("paid");
    expect((await sb.invoices.get(invoice))?.status).toBe("PAID");
    expect(board.log.filter((entry: any) => entry.kind === "webhook" && entry.note === "INVOICING.INVOICE.PAID" && entry.ids?.includes(invoice))).toHaveLength(1);
    expect(board.webhooks.filter((entry: any) => entry.id === "WH-REPEAT")).toEqual([{
      id: "WH-REPEAT",
      at: expect.any(String),
      eventType: "INVOICING.INVOICE.PAID",
      resourceId: invoice,
      verified: "SUCCESS",
      duplicates: 2,
    }]);
    const memberBoard = (await stub.state("https://ck.test", c.members[0].token) as any).body;
    expect(memberBoard).not.toHaveProperty("webhooks");
  });

  it("a new event id replaying an old PAID resource cannot override PayPal CANCELLED", async () => {
    const { c, stub, sb } = await circle();
    const invoice = (await state(stub, c)).rounds[0].shares[0].parts[0].invoiceId as string;
    sb.invoices.get(invoice)!.status = "CANCELLED";
    await deliver(validEvent("WH-OLD-PAID-NEW-ID", "INVOICING.INVOICE.PAID", { invoice: { id: invoice, status: "PAID" } }), { sb });
    const board = await state(stub, c);
    expect(board.rounds[0].shares[0].state).not.toBe("paid");
    expect(board.rounds[0].shares[0].parts[0].status).toBe("CANCELLED");
  });

  it("a late CANCELLED event cannot undo a fresh PayPal PAID status", async () => {
    const { c, stub, sb } = await circle();
    const invoice = (await state(stub, c)).rounds[0].shares[0].parts[0].invoiceId as string;
    sb.payInvoice(invoice);
    await deliver(validEvent("WH-PAID-FIRST", "INVOICING.INVOICE.PAID", { invoice: { id: invoice } }), { sb });
    await deliver(validEvent("WH-CANCEL-LATE", "INVOICING.INVOICE.CANCELLED", { invoice: { id: invoice } }), { sb });
    const board = await state(stub, c);
    expect(board.rounds[0].shares[0].state).toBe("paid");
    expect(board.rounds[0].shares[0].parts[0].status).toBe("PAID");
  });

  it("rejects malformed JSON with 400 and does not crash", async () => {
    const { status } = await deliver("{ definitely not json");
    expect(status).toBe(400);
  });

  it("rejects an empty body with 400", async () => {
    const { status } = await deliver("");
    expect(status).toBe(400);
  });

  it("rejects a body larger than 1 MB before processing it", async () => {
    const raw = validEvent("WH-TOO-LARGE", "INVOICING.INVOICE.PAID", { data: "x".repeat(1024 * 1024) });
    const { status } = await deliver(raw);
    expect(status).toBe(400);
  });

  it.each(["500", "timeout"] as const)("does not trust a verifier %s response", async (verdict) => {
    const { status, sb } = await deliver(validEvent("WH-VERIFY-OUTAGE", "UNKNOWN.EVENT", {}), { verdict });
    expect([400, 500, 502, 503]).toContain(status);
    expect(sb.calls("POST /v2/invoicing/invoices")).toHaveLength(0);
  }, 20000); // the client's own retry pauses on a 500 take about 3.5 s

  it("ignores a payout batch id no circle owns", async () => {
    const { sb } = await deliver(validEvent("WH-UNKNOWN-BATCH", "PAYMENT.PAYOUTSBATCH.SUCCESS", { batch_header: { payout_batch_id: "BATCH-NOBODY" } }));
    expect(sb.calls("GET /v1/payments/payouts/")).toHaveLength(0);
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("does not change another circle for its owned payout batch", async () => {
    const owner = await circle();
    const other = await circle();
    const batchId = "BATCH-OWNER-ONLY";
    await env.HUB.get(env.HUB.idFromName("hub")).index("batch", batchId, owner.c.id);
    const beforeOwner = await state(owner.stub, owner.c);
    const beforeOther = await state(other.stub, other.c);
    await deliver(validEvent("WH-OWNED-BATCH", "PAYMENT.PAYOUTSBATCH.SUCCESS", { batch_header: { payout_batch_id: batchId } }), { sb: owner.sb });
    const afterOwner = await state(owner.stub, owner.c);
    const afterOther = await state(other.stub, other.c);
    expect(afterOwner.rounds.map((r: any) => r.pot)).toEqual(beforeOwner.rounds.map((r: any) => r.pot));
    expect(afterOther.rounds.map((r: any) => r.pot)).toEqual(beforeOther.rounds.map((r: any) => r.pot));
  });

  it("answers 200 and ignores an unknown event type", async () => {
    const { status, sb } = await deliver(validEvent("WH-UNKNOWN-TYPE", "SOMETHING.NEW", { id: "irrelevant" }));
    expect(status).toBe(200);
    expect(sb.calls("POST /v2/invoicing/invoices")).toHaveLength(0);
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("PAID webhooks alone leave the pot drafted with no payout", async () => {
    const { c, stub, sb } = await circle();
    const board = await state(stub, c);
    const invoices = board.rounds[0].shares.map((s: any) => s.parts[0].invoiceId as string);
    for (const invoice of invoices) sb.payInvoice(invoice);
    for (const [i, invoice] of invoices.entries()) {
      await deliver(validEvent(`WH-ALL-PAID-${i}`, "INVOICING.INVOICE.PAID", { invoice: { id: invoice } }), { sb });
    }
    const after = await state(stub, c);
    expect(after.rounds[0].pot.status).toBe("drafted");
    expect(after.rounds[0].pot.confirmations).toEqual([]);
    expect(after.rounds[0].pot.payoutBatchId).toBeNull();
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });
});
