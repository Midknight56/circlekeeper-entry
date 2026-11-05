// The pot gate. Code, not the AI, decides when money goes out:
// (a) every live share of the round reads paid in a FRESH PayPal GET, (b) two distinct confirmers tapped,
// (c) no payout exists yet for this sender_batch_id. A webhook alone never releases money.

import { MAX_LIVE_POTS_PER_VISITOR_DAY, MAX_PAYOUT_CENTS_PER_DAY, utcDay } from "../caps";
import { createPayout, getPayout, originalPayoutBatchId } from "../paypal/payouts";
import { addLog, personaEmail, today, type Ctx } from "./context";
import { dayName } from "./messages";
import { keys, memberById, money, partPaid, shareFullyPaid, type Pot } from "./model";
import { ensurePot, loadCircle, refreshShare, sharesOfRound, type Result } from "./shares";

export const RESEND_AFTER_MS = 60_000;
export const MAX_SEND_TRIES = 12; // Bound automatic sends while PayPal may be accepting calls without answering.

function needsManualCheck(pot: Pot): boolean {
  return pot.refusal === "CHECK_BY_HAND" || (!pot.sentBy && /^(HTTP_0|HTTP_5|NO_CONNECTION|SERVICE_UNAVAILABLE|INTERNAL_SERVER_ERROR)/.test(pot.refusal || ""));
}

const MANUAL_CHECK_ERROR = "This payout may already be with PayPal, so it cannot be sent again from here. Check the PayPal account.";

export async function freshRoundCheck(ctx: Ctx, round: number): Promise<{ paid: boolean; unpaid: string[] }> {
  const c = await loadCircle(ctx);
  const shares = await sharesOfRound(ctx, round);
  const unpaid: string[] = [];
  for (const m of c.members) {
    const s = shares.find((x) => x.memberId === m.id);
    if (!s) {
      unpaid.push(m.id);
      continue;
    }
    // Throw away the local status: only what PayPal answers now counts.
    for (const p of s.parts) if (p.invoiceId && p.status !== "CANCELLED") p.status = "UNPAID";
    await refreshShare(ctx, s);
    const live = s.parts.filter((p) => p.status !== "CANCELLED");
    const checked = live.every((p) => p.invoiceId && p.checkedAt && partPaid(p));
    if (!shareFullyPaid(s, c.shareCents) || !checked) unpaid.push(m.id);
  }
  return { paid: unpaid.length === 0, unpaid };
}

export async function confirmRelease(ctx: Ctx, round: number, memberId: string): Promise<Result & { paidOut?: boolean }> {
  const c = await loadCircle(ctx);
  if (!c.rules.confirmers.includes(memberId)) return { ok: false, error: "only the circle's two confirmers can release the pot" };
  const pot = await ensurePot(ctx, c, round);
  if (needsManualCheck(pot)) return { ok: false, error: MANUAL_CHECK_ERROR };
  if (pot.payoutBatchId || pot.status === "paying" || pot.status === "paid") {
    return { ok: true, paidOut: false, note: "this pot was already sent" };
  }
  if (pot.status === "waiting") return { ok: false, error: "the round is not fully paid yet" };
  if (!pot.confirmations.some((x) => x.memberId === memberId)) {
    pot.confirmations.push({ memberId, at: ctx.now().toISOString() });
    await ctx.store.put(keys.pot(round), pot);
    await addLog(ctx, { kind: "rule", note: `${memberById(c, memberId)?.name || memberId} confirmed the round ${round} pot` });
  }
  const distinct = new Set(pot.confirmations.map((x) => x.memberId).filter((id) => c.rules.confirmers.includes(id)));
  if (distinct.size < 2) return { ok: true, paidOut: false, confirmations: distinct.size };
  return runPayout(ctx, round);
}

async function runPayout(ctx: Ctx, round: number): Promise<Result & { paidOut?: boolean }> {
  const c = await loadCircle(ctx);
  const pot = (await ctx.store.get<Pot>(keys.pot(round)))!;
  if (pot.waitUntil && today(ctx) < pot.waitUntil) {
    await addLog(ctx, { kind: "rule", note: `payout held: the circle agreed to wait until ${pot.waitUntil}` });
    return { ok: false, error: `the circle agreed to wait until ${dayName(pot.waitUntil, "en")}; the pot can go then` };
  }
  const check = await freshRoundCheck(ctx, round);
  if (!check.paid) {
    const names = check.unpaid.map((id) => memberById(c, id)?.name || id).join(", ");
    await addLog(ctx, { kind: "rule", note: `payout refused: not paid in PayPal yet (${names})` });
    return { ok: false, error: `not paid yet in PayPal: ${names}` };
  }
  if (pot.payoutBatchId || pot.status === "paying" || pot.status === "paid") return { ok: true, paidOut: false };
  // The sandbox merchant's payout money is finite and shared by every visitor: a demo copy pays out its first round
  // live (the round a judge plays through) and stops there.
  if (c.demo && round > 1) {
    await addLog(ctx, { kind: "rule", note: `demo: round ${round} is paid, but the demo pays out round 1 only` });
    return { ok: false, error: "This demo pays out round 1 only. Make your own circle to run more rounds." };
  }
  const day = utcDay(ctx.realNow());
  if (ctx.visitor && ctx.hub.takeLivePot && pot.liveSlotDay !== day) {
    if (!(await ctx.hub.takeLivePot(ctx.visitor, day, MAX_LIVE_POTS_PER_VISITOR_DAY))) {
      pot.status = "failed";
      pot.refusal = "NETWORK_POT_LIMIT";
      await ctx.store.put(keys.pot(round), pot);
      await addLog(ctx, { kind: "rule", note: "the network used today's live pots and this pot was not sent" });
      return { ok: false, error: "This network has used today's 3 live pots. This pot was not sent. Try again after 00:00 UTC." };
    }
    pot.liveSlotDay = day;
    await ctx.store.put(keys.pot(round), pot);
  }
  if (ctx.hub.takePayout && !(await ctx.hub.takePayout(day, pot.cents, MAX_PAYOUT_CENTS_PER_DAY))) {
    await addLog(ctx, { kind: "rule", note: "payout held: the day's sandbox payout cap is reached; it can be retried tomorrow" });
    return { ok: false, error: "today's sandbox payout limit is reached; try again tomorrow" };
  }
  return sendPayout(ctx, pot);
}

async function sendPayout(ctx: Ctx, pot: Pot): Promise<Result & { paidOut?: boolean }> {
  if (ctx.noLocalSend) {
    pot.status = "failed";
    pot.refusal = "LOCAL_NO_TEST_POT";
    await ctx.store.put(keys.pot(pot.round), pot);
    await addLog(ctx, { kind: "rule", note: "local payout refused because the test pot app is not configured" });
    return { ok: false, error: "Local payout refused because the test pot app is not configured." };
  }
  const c = await loadCircle(ctx);
  const round = pot.round;
  // Save the app and claim before the call so recovery uses the same app and identifiers.
  pot.status = "paying";
  pot.sentBy = "main";
  pot.sendTries = (pot.sendTries || 0) + 1;
  pot.lastSendAt = ctx.now().toISOString();
  delete pot.refusal;
  await ctx.store.put(keys.pot(round), pot);
  const recipient = memberById(c, pot.recipientId)!;
  const sender = ctx.sendPp || ctx.pp;
  const res = await createPayout(
    sender,
    {
      senderBatchId: pot.senderBatchId,
      senderItemId: `${pot.senderBatchId}-${recipient.id}`,
      recipientEmail: personaEmail(ctx.personas, recipient.slot),
      cents: ctx.sendCents || pot.cents,
      subject: `${c.name}: your pot`,
      message: `Round ${round} of ${c.name}: $${money(pot.cents)}. Sandbox test money.`,
      note: `Circlekeeper round ${round}`,
    },
    pot.requestId,
  );
  if (!res.payoutBatchId && res.status === 400 && res.body?.name === "USER_BUSINESS_ERROR" &&
      Array.isArray(res.body?.details) && res.body.details.some((d: any) => d?.field === "SENDER_BATCH_ID")) {
    const batchId = originalPayoutBatchId(res);
    if (batchId) {
      const got = await getPayout(sender, batchId);
      if (got.status !== 200) {
        if (pot.sendTries >= MAX_SEND_TRIES) {
          await requireManualCheck(ctx, pot);
          return { ok: false, error: MANUAL_CHECK_ERROR };
        }
        await addLog(ctx, { kind: "rule", note: "PayPal has the payout but its batch could not be checked; recovery will try again" });
        return { ok: true, paidOut: false, note: "PayPal did not answer. We will try again automatically." };
      }
      if (got.senderBatchId === pot.senderBatchId) {
        pot.payoutBatchId = batchId;
        pot.batchStatus = got.batchStatus;
        await ctx.store.put(keys.pot(round), pot);
        await ctx.hub.index("batch", batchId, ctx.circleId);
        await refreshPot(ctx, pot);
        await addLog(ctx, { kind: "rule", note: `round ${round} payout recovered from its original batch`, ids: [batchId] });
        return { ok: true, paidOut: true, payoutBatchId: batchId };
      }
    }
    await requireManualCheck(ctx, pot);
    return { ok: false, error: MANUAL_CHECK_ERROR };
  }
  if (!res.payoutBatchId && res.errorName !== "CK_DAILY_CAP" && (res.status === 0 || res.status === 429 || res.status >= 500)) {
    if (pot.sendTries >= MAX_SEND_TRIES) {
      pot.status = "failed";
      pot.refusal = "PAYPAL_NOT_ANSWERING";
      await ctx.store.put(keys.pot(round), pot);
      await addLog(ctx, { kind: "rule", note: "PayPal did not answer after many payout tries; automatic sends stopped" });
      return { ok: false, error: "PayPal did not answer after many tries. Try again when PayPal is back." };
    }
    await addLog(ctx, { kind: "rule", note: "PayPal did not answer the payout send; recovery will try again with the same identifiers" });
    return { ok: true, paidOut: false, note: "PayPal did not answer. We will try again automatically." };
  }
  if (!res.payoutBatchId) {
    pot.status = "failed";
    pot.refusal = res.errorName || `HTTP_${res.status}`;
    await ctx.store.put(keys.pot(round), pot);
    await addLog(ctx, { kind: "rule", note: `payout refused by PayPal: ${pot.refusal}` });
    const why = pot.refusal.startsWith("INSUFFICIENT_FUNDS")
      ? "the sandbox merchant has run out of test money for payouts; the pot stays safe and can be sent again later"
      : pot.refusal;
    return { ok: false, error: `PayPal refused the payout: ${why}` };
  }
  pot.payoutBatchId = res.payoutBatchId;
  pot.batchStatus = res.batchStatus;
  delete pot.refusal;
  await ctx.store.put(keys.pot(round), pot);
  await ctx.hub.index("batch", res.payoutBatchId, ctx.circleId);
  return { ok: true, paidOut: true, payoutBatchId: res.payoutBatchId };
}

async function requireManualCheck(ctx: Ctx, pot: Pot): Promise<void> {
  pot.status = "failed";
  pot.refusal = "CHECK_BY_HAND";
  await ctx.store.put(keys.pot(pot.round), pot);
  await addLog(ctx, { kind: "rule", note: `round ${pot.round} payout needs a manual check in the PayPal account before any further send` });
}

export async function recoverPayout(ctx: Ctx, pot: Pot): Promise<void> {
  if (pot.status !== "paying" || pot.payoutBatchId) return;
  if (!pot.sentBy) {
    await requireManualCheck(ctx, pot);
    return;
  }
  if (pot.lastSendAt && ctx.now().getTime() - Date.parse(pot.lastSendAt) < RESEND_AFTER_MS) return;
  try {
    await sendPayout(ctx, pot);
  } catch {
    if ((pot.sendTries || 0) >= MAX_SEND_TRIES) {
      pot.status = "failed";
      pot.refusal = "PAYPAL_NOT_ANSWERING";
      await ctx.store.put(keys.pot(pot.round), pot);
    }
    await addLog(ctx, { kind: "rule", note: "PayPal payout send threw during recovery" });
  }
}

/** Lets a failed pot be tried again with the same sender_batch_id and request id. */
export async function retryPayout(ctx: Ctx, round: number): Promise<Result & { paidOut?: boolean }> {
  const pot = await ctx.store.get<Pot>(keys.pot(round));
  if (!pot || pot.status !== "failed") return { ok: false, error: "nothing to retry" };
  // A batch id means PayPal accepted the send, even if its item later failed or was returned. Reusing that
  // batch cannot create a fresh payout, and resetting the pot to drafted would hide its terminal state.
  if (pot.payoutBatchId) return { ok: false, error: "PayPal already has this payout; its status is being reconciled" };
  if (needsManualCheck(pot)) return { ok: false, error: MANUAL_CHECK_ERROR };
  pot.sendTries = 0;
  pot.status = "drafted";
  await ctx.store.put(keys.pot(round), pot);
  return runPayout(ctx, round);
}

export async function onPayoutEvent(ctx: Ctx, batchId: string): Promise<void> {
  const pots = await ctx.store.list<Pot>({ prefix: "pot:" });
  for (const pot of pots.values()) {
    if (pot.payoutBatchId !== batchId) continue;
    await refreshPot(ctx, pot);
  }
}

export async function refreshPot(ctx: Ctx, pot: Pot): Promise<Pot> {
  if (!pot.payoutBatchId) return pot;
  let got = await getPayout(ctx.pp, pot.payoutBatchId);
  // The older app owns batches it sent before the switch.
  if (got.status !== 200 && ctx.payoutPp) got = await getPayout(ctx.payoutPp, pot.payoutBatchId);
  if (got.status !== 200) return pot;
  pot.batchStatus = got.batchStatus;
  pot.itemStatus = got.itemStatus;
  if (got.itemStatus === "SUCCESS" && pot.status !== "paid") {
    pot.status = "paid";
    pot.paidAt = ctx.now().toISOString();
    await addLog(ctx, { kind: "rule", note: `round ${pot.round} pot paid out: item SUCCESS`, ids: [pot.payoutBatchId] });
  } else if (got.itemStatus && ["FAILED", "RETURNED", "BLOCKED", "DENIED"].includes(got.itemStatus)) {
    pot.status = "failed";
    pot.refusal = got.itemStatus;
  } else if (got.batchStatus && ["DENIED", "CANCELED"].includes(got.batchStatus) && got.itemStatus !== "SUCCESS") {
    pot.status = "failed";
    pot.refusal = got.batchStatus;
    await addLog(ctx, { kind: "rule", note: `round ${pot.round} payout batch failed: ${got.batchStatus}`, ids: [pot.payoutBatchId] });
  }
  await ctx.store.put(keys.pot(pot.round), pot);
  return pot;
}
