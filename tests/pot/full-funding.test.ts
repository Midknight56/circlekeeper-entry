import { expect, it } from "vitest";
import { confirmRelease, freshRoundCheck, onPayoutEvent } from "../../src/circle/gate";
import { getShare, issueRound, maybeDraftPot, onInvoiceEvent, recordCashShare, startCircle } from "../../src/circle/shares";
import { keys, type Pot } from "../../src/circle/model";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { settleRound } from "../../src/circle/settle";
import { world } from "../helpers/world";

async function shortRound() {
  const w = await world();
  await startCircle(w.ctx);
  const split = await proposeSplit(w.ctx, 1, "sam", 6000);
  await consentSplit(w.ctx, split.split!.id, "sam", "yes");
  const sam = (await getShare(w.ctx, 1, "sam"))!;
  w.sb.payInvoice(sam.parts[1].invoiceId!);
  w.sb.invoices.get(sam.parts[2].invoiceId!)!.status = "CANCELLED";
  await onInvoiceEvent(w.ctx, sam.parts[2].invoiceId!, "INVOICING.INVOICE.CANCELLED");
  for (const m of w.circle.members.filter((m) => m.id !== "sam")) await recordCashShare(w.ctx, 1, m.id);
  return w;
}

it("does not draft a pot with a cancelled unpaid split balance", async () => {
  const w = await shortRound();
  expect((await settleRound(w.ctx, 1)).paidCents).toBe(56000);
  expect((await w.store.get<Pot>(keys.pot(1)))!.status).toBe("waiting");
  await confirmRelease(w.ctx, 1, "dana");
  await confirmRelease(w.ctx, 1, "theo");
  expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
});

it("fresh release refuses the cancelled balance even if a pot was already drafted", async () => {
  const w = await shortRound();
  const pot = (await w.store.get<Pot>(keys.pot(1)))!;
  pot.status = "drafted";
  await w.store.put(keys.pot(1), pot);
  await confirmRelease(w.ctx, 1, "dana");
  const result = await confirmRelease(w.ctx, 1, "theo");
  expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  expect(result.ok).toBe(false);
  expect((await freshRoundCheck(w.ctx, 1)).unpaid).toEqual(["sam"]);
});

it("drafting requires a full share for each current member", async () => {
  const w = await shortRound();
  await w.store.delete(keys.share(1, "sam"));
  const other = (await getShare(w.ctx, 1, "theo"))!;
  await w.store.put(keys.share(1, "outsider"), { ...other, memberId: "outsider" });
  const pot = (await w.store.get<Pot>(keys.pot(1)))!;
  pot.status = "waiting";
  await w.store.put(keys.pot(1), pot);
  expect(await maybeDraftPot(w.ctx, 1)).toBe(false);
});

it("invoice retry restores only the missing balance and a fully paid round balances", async () => {
  const w = await shortRound();
  const creates = w.sb.calls("POST /v2/invoicing/invoices").filter((s) => s.path === "/v2/invoicing/invoices").length;
  expect((await issueRound(w.ctx, 1)).ok).toBe(true);
  const sam = (await getShare(w.ctx, 1, "sam"))!;
  const replacement = sam.parts.find((p) => p.status === "SENT");
  expect(replacement?.cents).toBe(4000);
  expect(replacement?.dueDate).toBe("2026-12-24");
  expect(replacement?.invoiceId).toBeTruthy();
  await issueRound(w.ctx, 1);
  expect(w.sb.calls("POST /v2/invoicing/invoices").filter((s) => s.path === "/v2/invoicing/invoices")).toHaveLength(creates + 1);
  w.sb.payInvoice(replacement!.invoiceId!);
  await onInvoiceEvent(w.ctx, replacement!.invoiceId!, "INVOICING.INVOICE.PAID");
  await confirmRelease(w.ctx, 1, "dana");
  expect((await confirmRelease(w.ctx, 1, "theo")).paidOut).toBe(true);
  const pot = (await w.store.get<Pot>(keys.pot(1)))!;
  await onPayoutEvent(w.ctx, pot.payoutBatchId!);
  expect(await settleRound(w.ctx, 1)).toMatchObject({ paidCents: 60000, paidOutCents: 60000, balanced: true });
});

it("a failed balance invoice retries with the same saved identifiers", async () => {
  const w = await shortRound();
  w.sb.failInvoiceCreates(1, 400, 0);
  expect((await issueRound(w.ctx, 1)).ok).toBe(false);
  expect((await getShare(w.ctx, 1, "sam"))!.recoveryError).toContain("invoice");
  const pending = (await getShare(w.ctx, 1, "sam"))!.parts.find((p) => p.status === "DRAFT")!;
  expect(pending?.cents).toBe(4000);
  expect((await issueRound(w.ctx, 1)).ok).toBe(true);
  const restored = (await getShare(w.ctx, 1, "sam"))!.parts.find((p) => p.number === pending.number)!;
  expect(restored.requestId).toBe(pending.requestId);
  expect(restored.status).toBe("SENT");
  expect((await getShare(w.ctx, 1, "sam"))!.recoveryError).toBeUndefined();
});

it("does not replace a cancelled invoice while its checkout is uncertain", async () => {
  const w = await shortRound();
  const sam = (await getShare(w.ctx, 1, "sam"))!;
  sam.parts[2].orderState = "unknown";
  sam.parts[2].orderId = "UNCERTAIN";
  await w.store.put(keys.share(1, "sam"), sam);
  const before = w.sb.calls("POST /v2/invoicing/invoices").length;
  expect((await issueRound(w.ctx, 1)).ok).toBe(false);
  expect(w.sb.calls("POST /v2/invoicing/invoices")).toHaveLength(before);
});

it("does not replace a cancelled balance whose invoice cannot be verified", async () => {
  const w = await shortRound();
  const sam = (await getShare(w.ctx, 1, "sam"))!;
  w.sb.invoices.delete(sam.parts[2].invoiceId!);
  const before = w.sb.calls("POST /v2/invoicing/invoices").length;
  expect((await issueRound(w.ctx, 1)).ok).toBe(false);
  expect(w.sb.calls("POST /v2/invoicing/invoices")).toHaveLength(before);
});

it("keeps an uncertain cancelled balance partial, visible and held until safe recovery", async () => {
  const w = await shortRound();
  const sam = (await getShare(w.ctx, 1, "sam"))!;
  sam.parts[2].orderState = "unknown";
  sam.parts[2].orderId = "UNCERTAIN";
  await w.store.put(keys.share(1, "sam"), sam);
  await issueRound(w.ctx, 1);
  const { stateFor } = await import("../../src/circle/state");
  // @ts-ignore shared page module
  const { potTiming } = await import("../../public/js/schedule-model.js");
  const state: any = await stateFor(w.ctx, await w.load(), { role: "organiser" }, {});
  const round = state.rounds[0];
  const shown = round.shares.find((s: any) => s.memberId === "sam");
  expect(shown.state).toBe("partial");
  expect(round.shares.filter((s: any) => s.state === "paid")).toHaveLength(5);
  expect(shown.balanceCents).toBe(4000);
  expect(shown.recoveryError).toContain("Check the PayPal account");
  expect((await getShare(w.ctx, 1, "sam"))!).toHaveProperty("recoveryError", shown.recoveryError);
  expect(potTiming(round, state.now)).toMatchObject({ held: true, heldBy: ["sam"] });
  const own: any = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "sam" }, {});
  expect(own.rounds[0].shares.find((s: any) => s.memberId === "sam")).toMatchObject({ balanceCents: 4000, recoveryError: shown.recoveryError });
  const privateView: any = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "dana" }, {});
  const hidden = privateView.rounds[0].shares.find((s: any) => s.memberId === "sam");
  expect(hidden.balanceCents).toBeUndefined();
  expect(hidden.recoveryError).toBeUndefined();
  expect(potTiming(privateView.rounds[0], state.now)).toMatchObject({ held: true, heldBy: ["sam"] });
  // A verified closed checkout permits the existing retry to restore just the balance.
  const checked = (await getShare(w.ctx, 1, "sam"))!;
  checked.parts[2].orderState = "closed";
  await w.store.put(keys.share(1, "sam"), checked);
  expect((await issueRound(w.ctx, 1)).ok).toBe(true);
  const restored = (await getShare(w.ctx, 1, "sam"))!;
  expect((restored as any).recoveryError).toBeUndefined();
  const replacement = restored.parts.at(-1)!;
  expect(replacement.cents).toBe(4000);
  w.sb.payInvoice(replacement.invoiceId!);
  await onInvoiceEvent(w.ctx, replacement.invoiceId!, "INVOICING.INVOICE.PAID");
  const after: any = await stateFor(w.ctx, await w.load(), { role: "organiser" }, {});
  expect(after.rounds[0].shares.find((s: any) => s.memberId === "sam")).toMatchObject({ state: "paid", balanceCents: 0, recoveryError: null });
  expect(potTiming(after.rounds[0], state.now).held).toBe(false);
});
