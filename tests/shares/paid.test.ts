import { describe, expect, it } from "vitest";
import { startCircle, onInvoiceEvent, recordCashShare, getShare, invoiceNumber, MAX_INVOICE_NUMBER } from "../../src/circle/shares";
import { shareState } from "../../src/circle/model";
import { world } from "../helpers/world";

describe("shares", () => {
  it("every invoice number fits PayPal's 25 character limit, split parts too", async () => {
    const c = { id: "abcdefghij", members: Array.from({ length: 6 }, (_, i) => ({ id: "a-very-long-member-name-" + i })) } as any;
    for (const m of c.members) {
      for (const suffix of ["", "-a", "-b"]) expect(invoiceNumber(c, 12, m.id, suffix).length).toBeLessThanOrEqual(MAX_INVOICE_NUMBER);
    }
  });

  it("start sends one invoice per member for round 1, numbered CK-<circle>-<round>-<member>", async () => {
    const w = await world();
    const res = await startCircle(w.ctx);
    expect(res.ok).toBe(true);
    expect(w.sb.invoices.size).toBe(6);
    const numbers = [...w.sb.invoices.values()].map((i) => i.number).sort();
    expect(numbers).toEqual(["CK-c1-01-1", "CK-c1-01-2", "CK-c1-01-3", "CK-c1-01-4", "CK-c1-01-5", "CK-c1-01-6"]);
    for (const inv of w.sb.invoices.values()) {
      expect(inv.status).toBe("SENT");
      expect(inv.cents).toBe(10000);
    }
    expect((await w.load()).status).toBe("active");
    // every invoice is in the hub's index, so its webhooks route here
    for (const id of w.sb.invoices.keys()) expect(await w.hub.lookup("inv", id)).toBe("c1");
  });

  it("starting twice does not send a second set", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await startCircle(w.ctx);
    expect(w.sb.invoices.size).toBe(6);
  });

  it("a PAID webhook marks the share paid only after the GET says PAID", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const share = (await getShare(w.ctx, 1, "keisha"))!;
    const invId = share.parts[0].invoiceId!;
    await onInvoiceEvent(w.ctx, invId, "INVOICING.INVOICE.PAID");
    expect(shareState(await getShare(w.ctx, 1, "keisha"), 10000)).toBe("sent");
    w.sb.payInvoice(invId);
    await onInvoiceEvent(w.ctx, invId, "INVOICING.INVOICE.PAID");
    const after = (await getShare(w.ctx, 1, "keisha"))!;
    expect(shareState(after, 10000)).toBe("paid");
    expect(after.parts[0].paidAt).toBeTruthy();
  });

  it("a cash share is recorded with PayPal and reads MARKED_AS_PAID", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const r = await recordCashShare(w.ctx, 1, "sam");
    expect(r.ok).toBe(true);
    const s = (await getShare(w.ctx, 1, "sam"))!;
    expect(s.parts[0].status).toBe("MARKED_AS_PAID");
    expect(w.sb.invoices.get(s.parts[0].invoiceId!)!.status).toBe("MARKED_AS_PAID");
  });

  it("the last share of a round drafts the pot release", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of ["keisha", "marisol", "dana", "theo", "amelie", "sam"]) await recordCashShare(w.ctx, 1, m);
    const pot = await w.store.get<any>("pot:01");
    expect(pot.status).toBe("drafted");
    expect(pot.recipientId).toBe("marisol");
    expect(pot.cents).toBe(60000);
  });
});

describe("lost answers", () => {
  it("a create whose answer was lost is recovered by its invoice number, not made twice", async () => {
    const w = await world();
    const planted = w.sb.plantInvoice("CK-c1-01-1", 10000);
    await startCircle(w.ctx);
    expect(w.sb.invoices.size).toBe(6);
    const s = (await getShare(w.ctx, 1, "keisha"))!;
    expect(s.parts[0].invoiceId).toBe(planted);
    expect(s.parts[0].status).toBe("SENT");
    expect(await w.hub.lookup("inv", planted)).toBe("c1");
  });

  it("an invoice PayPal already sent counts as sent", async () => {
    const w = await world();
    w.sb.plantInvoice("CK-c1-01-1", 10000, "SENT");
    const r = await startCircle(w.ctx);
    expect(r.ok).toBe(true);
    const s = (await getShare(w.ctx, 1, "keisha"))!;
    expect(s.parts[0].status).toBe("SENT");
  });
});
