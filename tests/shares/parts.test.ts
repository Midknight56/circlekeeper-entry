import { expect, it } from "vitest";
import { getShare, payShareByTestCard, recordCashShare, startCircle, startOrderShare } from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { world } from "../helpers/world";

async function splitWorld() {
  const w = await world();
  await startCircle(w.ctx);
  const proposal = await proposeSplit(w.ctx, 1, "marisol", 6000);
  await consentSplit(w.ctx, proposal.split!.id, "marisol", "yes");
  const parts = (await getShare(w.ctx, 1, "marisol"))!.parts.filter((p) => p.status !== "CANCELLED");
  return { ...w, parts };
}

it("a card pays only the selected split part", async () => {
  const w = await splitWorld();
  for (const m of w.circle.members.filter((m) => m.id !== "marisol")) await recordCashShare(w.ctx, 1, m.id);
  expect((await payShareByTestCard(w.ctx, 1, "marisol", w.parts[0].number)).ok).toBe(true);
  expect(w.sb.invoices.get(w.parts[0].invoiceId!)!.status).toBe("MARKED_AS_PAID");
  expect(w.sb.invoices.get(w.parts[1].invoiceId!)!.status).toBe("SENT");
  expect((await w.store.get<any>("pot:01")).status).toBe("waiting");
  expect((await payShareByTestCard(w.ctx, 1, "marisol", w.parts[1].number)).ok).toBe(true);
  expect((await w.store.get<any>("pot:01")).status).toBe("drafted");
});

it("checkout uses the selected later part amount", async () => {
  const w = await splitWorld();
  expect((await startOrderShare(w.ctx, 1, "marisol", w.parts[1].number)).ok).toBe(true);
  expect(w.sb.calls("POST /v2/checkout/orders")[0].body.purchase_units[0].amount.value).toBe("40.00");
});

it("another member's part is refused without a payment write", async () => {
  const w = await splitWorld();
  const other = (await getShare(w.ctx, 1, "keisha"))!.parts[0].number;
  expect(await payShareByTestCard(w.ctx, 1, "marisol", other)).toEqual({ ok: false, error: "that part is not yours or is already paid" });
  expect((await startOrderShare(w.ctx, 1, "marisol", other)).ok).toBe(false);
  expect(w.sb.calls("POST /v2/checkout/orders")).toHaveLength(0);
});

it("old card clients pay only the first unpaid part", async () => {
  const w = await splitWorld();
  expect((await payShareByTestCard(w.ctx, 1, "marisol")).ok).toBe(true);
  expect(w.sb.invoices.get(w.parts[1].invoiceId!)!.status).toBe("SENT");
});

it("rejects unknown, cancelled, paid and wrong round parts without payment writes", async () => {
  const w = await splitWorld();
  const cancelled = (await getShare(w.ctx, 1, "marisol"))!.parts[0].number;
  w.sb.payInvoice(w.parts[0].invoiceId!);
  for (const part of ["", "missing", cancelled, w.parts[0].number]) {
    expect(await payShareByTestCard(w.ctx, 1, "marisol", part)).toEqual({ ok: false, error: "that part is not yours or is already paid" });
    expect((await startOrderShare(w.ctx, 1, "marisol", part)).ok).toBe(false);
  }
  expect((await payShareByTestCard(w.ctx, 2, "marisol", w.parts[1].number)).ok).toBe(false);
  expect((await startOrderShare(w.ctx, 2, "marisol", w.parts[1].number)).ok).toBe(false);
  expect(w.sb.calls("POST /v2/checkout/orders")).toHaveLength(0);
});
