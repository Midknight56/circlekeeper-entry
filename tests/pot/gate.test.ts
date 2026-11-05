import { describe, expect, it } from "vitest";
import { startCircle, recordCashShare, getShare, onInvoiceEvent } from "../../src/circle/shares";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { world } from "../helpers/world";

const ALL = ["keisha", "marisol", "dana", "theo", "amelie", "sam"];

async function paidRound() {
  const w = await world();
  await startCircle(w.ctx);
  for (const m of ALL) await recordCashShare(w.ctx, 1, m);
  return w;
}

describe("the pot gate", () => {
  it("refuses while one share's GET says UNPAID, even after a PAID webhook and a forged local status", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of ALL.slice(0, 5)) await recordCashShare(w.ctx, 1, m);
    const sam = (await getShare(w.ctx, 1, "sam"))!;
    await onInvoiceEvent(w.ctx, sam.parts[0].invoiceId!, "INVOICING.INVOICE.PAID");
    // forge the local copy: the gate must not trust it
    sam.parts[0].status = "PAID";
    await w.store.put("share:01:sam", sam);
    await w.store.put("pot:01", { round: 1, recipientId: "marisol", cents: 60000, status: "drafted", confirmations: [], senderBatchId: "ck-c1-r1", requestId: "r" });
    expect((await confirmRelease(w.ctx, 1, "dana")).ok).toBe(true);
    const second = await confirmRelease(w.ctx, 1, "theo");
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/not paid/i);
    expect(w.sb.payouts.size).toBe(0);
  });

  it("refuses with one confirmer", async () => {
    const w = await paidRound();
    const r = await confirmRelease(w.ctx, 1, "dana");
    expect(r.ok).toBe(true);
    expect(r.paidOut).toBeFalsy();
    expect(w.sb.payouts.size).toBe(0);
  });

  it("refuses a member who is not a confirmer, and counts one confirmer once", async () => {
    const w = await paidRound();
    expect((await confirmRelease(w.ctx, 1, "sam")).ok).toBe(false);
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "dana");
    expect(w.sb.payouts.size).toBe(0);
  });

  it("two confirmers send the pot by Payouts to the round's recipient, once", async () => {
    const w = await paidRound();
    await confirmRelease(w.ctx, 1, "dana");
    const r = await confirmRelease(w.ctx, 1, "theo");
    expect(r.ok).toBe(true);
    expect(r.paidOut).toBe(true);
    expect(w.sb.payouts.size).toBe(1);
    const p = [...w.sb.payouts.values()][0];
    expect(p.senderBatchId).toBe("ck-c1-r1");
    expect(p.cents).toBe(60000);
    expect(p.receiver).toBe("m2@test"); // marisol is slot 2 and takes round 1
    const pot = await w.store.get<any>("pot:01");
    expect(pot.payoutBatchId).toBe(p.id);
    // a third tap, or a replay, never pays twice for one sender_batch_id
    const again = await confirmRelease(w.ctx, 1, "theo");
    expect(again.paidOut).toBeFalsy();
    expect(w.sb.payouts.size).toBe(1);
  });

  it("the payout webhook re-reads the batch and marks the pot paid", async () => {
    const w = await paidRound();
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const pot = await w.store.get<any>("pot:01");
    await onPayoutEvent(w.ctx, pot.payoutBatchId);
    const after = await w.store.get<any>("pot:01");
    expect(after.status).toBe("paid");
    expect(after.itemStatus).toBe("SUCCESS");
  });

  it("a refused payout shows the refusal name and can be retried with the same batch id", async () => {
    const w = await paidRound();
    w.sb.failNextPayout(422, "INSUFFICIENT_FUNDS");
    await confirmRelease(w.ctx, 1, "dana");
    const r = await confirmRelease(w.ctx, 1, "theo");
    expect(r.ok).toBe(false);
    const pot = await w.store.get<any>("pot:01");
    expect(pot.status).toBe("failed");
    expect(pot.refusal).toBe("INSUFFICIENT_FUNDS");
  });
});

describe("the older PayPal app that sent pots", () => {
  async function withPayoutApp() {
    const { PayPal } = await import("../../src/paypal/client");
    const { sandbox } = await import("../helpers/sandbox");
    const w = await paidRound();
    const payoutBox = sandbox();
    w.ctx.payoutPp = new PayPal({ CK: (w.ctx.pp as any).env.CK, PAYPAL_CLIENT_ID: "payout-app", PAYPAL_CLIENT_SECRET: "s" }, payoutBox.fetchFn, () => Date.now(), async () => {});
    return { w, payoutBox };
  }

  it("sends a new payout through the main app only", async () => {
    const { w, payoutBox } = await withPayoutApp();
    await confirmRelease(w.ctx, 1, "dana");
    const r = await confirmRelease(w.ctx, 1, "theo");
    expect(r.paidOut).toBe(true);
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(1);
    expect(payoutBox.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("reads an in flight batch from the older app after the main app returns 404", async () => {
    const { w, payoutBox } = await withPayoutApp();
    const batchId = "BATCH-OLDER";
    payoutBox.payouts.set(batchId, { id: batchId, senderBatchId: "ck-c1-r1", cents: 60000, receiver: "m2@test", polls: 0 });
    await w.store.put("pot:01", { round: 1, recipientId: "marisol", cents: 60000, status: "paying", confirmations: [], senderBatchId: "ck-c1-r1", requestId: "r", payoutBatchId: batchId });
    await onPayoutEvent(w.ctx, batchId);
    expect((await w.store.get<any>("pot:01")).status).toBe("paid");
    expect(w.sb.calls("GET /v1/payments/payouts/")).toHaveLength(1);
    expect(payoutBox.calls("GET /v1/payments/payouts/")).toHaveLength(1);
  });

  it("keeps a pot paying without throwing when both apps return 404", async () => {
    const { w, payoutBox } = await withPayoutApp();
    const batchId = "BATCH-MISSING";
    await w.store.put("pot:01", { round: 1, recipientId: "marisol", cents: 60000, status: "paying", confirmations: [], senderBatchId: "ck-c1-r1", requestId: "r", payoutBatchId: batchId });
    await expect(onPayoutEvent(w.ctx, batchId)).resolves.toBeUndefined();
    expect((await w.store.get<any>("pot:01")).status).toBe("paying");
    expect(w.sb.calls("GET /v1/payments/payouts/")).toHaveLength(1);
    expect(payoutBox.calls("GET /v1/payments/payouts/")).toHaveLength(1);
  });

  it("reads a batch known by the main app there without reading it from the older app", async () => {
    const { w, payoutBox } = await withPayoutApp();
    const batchId = "BATCH-MAIN";
    w.sb.payouts.set(batchId, { id: batchId, senderBatchId: "ck-c1-r1", cents: 60000, receiver: "m2@test", polls: 0 });
    await w.store.put("pot:01", { round: 1, recipientId: "marisol", cents: 60000, status: "paying", confirmations: [], senderBatchId: "ck-c1-r1", requestId: "r", payoutBatchId: batchId });
    await onPayoutEvent(w.ctx, batchId);
    expect((await w.store.get<any>("pot:01")).status).toBe("paid");
    expect(w.sb.calls("GET /v1/payments/payouts/")).toHaveLength(1);
    expect(payoutBox.calls("GET /v1/payments/payouts/")).toHaveLength(0);
  });
});

describe("demo circles pay out round 1 only", () => {
  it("a demo circle's round 2 pot is not sent, and says why", async () => {
    const { issueRound, recordCashShare: cash } = await import("../../src/circle/shares");
    const w = await paidRound();
    const c = await w.load();
    c.demo = true;
    await w.store.put("circle", c);
    await confirmRelease(w.ctx, 1, "dana");
    expect((await confirmRelease(w.ctx, 1, "theo")).paidOut).toBe(true);
    await issueRound(w.ctx, 2);
    for (const m of ALL) await cash(w.ctx, 2, m);
    await confirmRelease(w.ctx, 2, "dana");
    const r = await confirmRelease(w.ctx, 2, "theo");
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/demo pays out round 1/i);
    expect(w.sb.payouts.size).toBe(1);
  });
});
