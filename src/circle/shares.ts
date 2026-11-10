// Shares come in by PayPal invoice. One record per member per round, so six webhooks never race on one record.

import { cancelInvoice, createInvoice, findInvoiceByNumber, getInvoice, recordCash, sendInvoice } from "../paypal/invoices";
import { DAILY_CAP_TEXT } from "../caps";
import { captureOrder, getOrder, orderRequestBody, sendOrder, testCardOrderRequestBody } from "../paypal/orders";
import { LINES } from "./messages";
import { addDays, addLog, personaEmail, today, type Ctx } from "./context";
import {
  keys,
  memberById,
  money,
  partPaid,
  shareFullyPaid,
  recipientOf,
  type Circle,
  type Pot,
  type Share,
  type SharePart,
} from "./model";

export type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string; [k: string]: unknown };

export async function loadCircle(ctx: Ctx): Promise<Circle> {
  const c = await ctx.store.get<Circle>(keys.circle());
  if (!c) throw new Error("no circle");
  return c;
}

export async function saveCircle(ctx: Ctx, c: Circle): Promise<void> {
  c.version++;
  await ctx.store.put(keys.circle(), c);
}

export async function getShare(ctx: Ctx, round: number, memberId: string): Promise<Share | undefined> {
  return ctx.store.get<Share>(keys.share(round, memberId));
}

export async function sharesOfRound(ctx: Ctx, round: number): Promise<Share[]> {
  return [...(await ctx.store.list<Share>({ prefix: keys.sharesOfRound(round) })).values()];
}

export function roundDue(c: Circle, round: number): string {
  // A share is due five days before that round's pot date.
  const slot = c.rotation.find((s) => s.round === round);
  return addDays(slot ? slot.date : `${c.startMonth}-15`, -5);
}

// PayPal refuses an invoice_number longer than 25 characters (INVALID_STRING_MAX_LENGTH, measured 23 Oct:
// 25 gave 201, 26 gave 400). CK-<circle id, 10>-<round, 2>-<member number><a or b> is at most 21.
export const MAX_INVOICE_NUMBER = 25;

export function invoiceNumber(c: Circle, round: number, memberId: string, suffix = ""): string {
  const n = c.members.findIndex((m) => m.id === memberId) + 1;
  return `CK-${c.id.slice(0, 10)}-${String(round).padStart(2, "0")}-${n}${suffix}`;
}

/** Creates, sends and indexes one invoice part. The part is stored with its request id before PayPal is called. */
export async function issuePart(
  ctx: Ctx,
  c: Circle,
  share: Share,
  part: SharePart,
  subject: string,
  note: string,
): Promise<true | string> {
  const m = memberById(c, share.memberId)!;
  if (!part.invoiceId) {
    const created = await createInvoice(
      ctx.pp,
      {
        number: part.number,
        invoicerEmail: ctx.personas.merchant,
        recipientEmail: personaEmail(ctx.personas, m.slot),
        recipientName: m.name,
        cents: part.cents,
        dueDate: part.dueDate,
        itemName: `${c.name}: share for round ${share.round}`,
        note,
      },
      part.requestId,
    );
    let id = created.id;
    if (!id && created.errorName?.includes("DUPLICATE_INVOICE_NUMBER")) {
      // An earlier create went through but its answer was lost: find that invoice instead of making a second.
      const found = await findInvoiceByNumber(ctx.pp, part.number);
      id = found.id;
    }
    if (!id) return created.errorName || `HTTP_${created.status}`;
    part.invoiceId = id;
    await ctx.hub.index("inv", id, ctx.circleId);
    await ctx.store.put(keys.share(share.round, share.memberId), share);
  }
  if (part.status === "DRAFT") {
    const sent = await sendInvoice(ctx.pp, part.invoiceId, subject, note, part.requestId + "-send");
    if (sent.status >= 300 && !sent.errorName?.includes("INVOICE_ALREADY_SENT")) return sent.errorName || `HTTP_${sent.status}`;
    part.status = "SENT";
    const got = await getInvoice(ctx.pp, part.invoiceId);
    if (got.payerUrl) part.payerUrl = got.payerUrl;
    if (got.invoiceStatus) part.status = got.invoiceStatus as SharePart["status"];
    part.checkedAt = ctx.now().toISOString();
    await ctx.store.put(keys.share(share.round, share.memberId), share);
  }
  return true;
}

export async function issueRound(ctx: Ctx, round: number): Promise<Result> {
  const c = await loadCircle(ctx);
  const errors: string[] = [];
  for (const m of c.members) {
    let share = await getShare(ctx, round, m.id);
    if (!share) {
      share = {
        round,
        memberId: m.id,
        reminders: [],
        parts: [
          {
            cents: c.shareCents,
            dueDate: roundDue(c, round),
            status: "DRAFT",
            requestId: crypto.randomUUID(),
            number: invoiceNumber(c, round, m.id),
          },
        ],
      };
      await ctx.store.put(keys.share(round, m.id), share);
    }
    const recovery = await restoreShareBalance(ctx, c, share);
    if (recovery !== true) {
      share.recoveryError = recovery;
      await ctx.store.put(keys.share(round, m.id), share);
      errors.push(recovery);
      continue;
    }
    delete share.recoveryError;
    for (const part of share.parts) {
      if (part.status !== "DRAFT") continue;
      const ok = await issuePart(ctx, c, share, part, `${c.name}: your share`, `Your share of $${money(part.cents)} for round ${round}.`);
      if (ok !== true) {
        errors.push(ok);
        share.recoveryError = sendError([ok]).replace("Tap Start again to send the rest", "We will try again");
      }
    }
    await ctx.store.put(keys.share(round, m.id), share);
  }
  await ensurePot(ctx, c, round);
  return errors.length ? { ok: false, error: sendError(errors), failed: errors.length } : { ok: true };
}

/** The normal invoice retry also restores a verified cancelled balance, keeping paid parts intact. */
async function restoreShareBalance(ctx: Ctx, c: Circle, share: Share): Promise<true | string> {
  const live = share.parts.filter((p) => p.status !== "CANCELLED");
  const balance = c.shareCents - live.reduce((sum, p) => sum + p.cents, 0);
  if (balance <= 0) return true;
  // A cancelled invoice does not settle an outstanding checkout or a captured payment.
  if (share.parts.some((p) => p.recordPending || p.status === "CANCELLED" && (checkoutPending(p) || p.captureId))) {
    return "This share needs a payment check. Check the PayPal account before replacing its invoice.";
  }
  for (const part of share.parts.filter((p) => p.status === "CANCELLED")) {
    if (!part.invoiceId) continue;
    const got = await getInvoice(ctx.pp, part.invoiceId);
    if (got.status !== 200 || got.invoiceStatus !== "CANCELLED") {
      return "The cancelled invoice could not be verified. Check the PayPal account before replacing it.";
    }
  }
  const replacement: SharePart = {
    cents: balance,
    dueDate: [roundDue(c, share.round), today(ctx), ...share.parts.filter((p) => p.status === "CANCELLED").map((p) => p.dueDate)].sort().at(-1)!,
    status: "DRAFT",
    requestId: crypto.randomUUID(),
    number: invoiceNumber(c, share.round, share.memberId, `-r${share.parts.length}`),
  };
  share.parts.push(replacement);
  await ctx.store.put(keys.share(share.round, share.memberId), share);
  await addLog(ctx, { kind: "rule", note: `round ${share.round} missing share invoice restored for ${memberById(c, share.memberId)!.name}` });
  return true;
}

/** One sentence for the person who tapped: what went wrong and what to do. */
export function sendError(errors: string[]): string {
  const n = errors.length;
  const what = n === 1 ? "1 invoice" : `${n} invoices`;
  if (errors.some((e) => e.includes("CK_DAILY_CAP"))) {
    return `${what} not sent: today's sandbox limit for PayPal calls is reached. It resets at 00:00 UTC.`;
  }
  if (errors.every((e) => /^(HTTP_5\d\d|HTTP_0|NO_CONNECTION|SERVICE_UNAVAILABLE|INTERNAL_SERVER_ERROR)/.test(e))) {
    return `PayPal did not answer for ${what}. Tap Start again to send the rest; nothing is sent twice.`;
  }
  return `PayPal refused ${what} (${[...new Set(errors)].join(", ")}). The activity panel has the details.`;
}

export async function ensurePot(ctx: Ctx, c: Circle, round: number): Promise<Pot> {
  const existing = await ctx.store.get<Pot>(keys.pot(round));
  if (existing) return existing;
  const pot: Pot = {
    round,
    recipientId: recipientOf(c, round)!,
    cents: c.shareCents * c.members.length,
    status: "waiting",
    confirmations: [],
    senderBatchId: `ck-${c.id}-r${round}`,
    requestId: crypto.randomUUID(),
  };
  await ctx.store.put(keys.pot(round), pot);
  return pot;
}

export async function startCircle(ctx: Ctx): Promise<Result> {
  const c = await loadCircle(ctx);
  if (c.status === "draft") {
    if (c.unused?.length && JSON.stringify(c.unusedAccepted) !== JSON.stringify(c.unused)) {
      return { ok: false, error: "Review the unused text. Accept leaving it out before Start." };
    }
    c.status = "active";
    await saveCircle(ctx, c);
    await addLog(ctx, { kind: "rule", note: "circle started by the organiser" });
  }
  return issueRound(ctx, 1);
}

/** Re-reads every live invoice part of a share from PayPal and stores what PayPal says. */
export async function refreshShare(ctx: Ctx, share: Share): Promise<Share> {
  let changed = false;
  for (const part of share.parts) {
    if (!part.invoiceId || part.status === "CANCELLED") continue;
    const got = await getInvoice(ctx.pp, part.invoiceId);
    if (got.status !== 200 || !got.invoiceStatus) continue;
    const was = part.status;
    part.status = got.invoiceStatus as SharePart["status"];
    if (got.payerUrl) part.payerUrl = got.payerUrl;
    part.checkedAt = ctx.now().toISOString();
    if (!partPaid({ ...part, status: was }) && partPaid(part)) part.paidAt = ctx.now().toISOString();
    if (partPaid(part) && !part.paymentMethod) part.paymentMethod = "PAYPAL";
    changed = true;
  }
  if (changed) await ctx.store.put(keys.share(share.round, share.memberId), share);
  return share;
}

export async function findShareByInvoice(ctx: Ctx, invoiceId: string): Promise<Share | undefined> {
  const all = await ctx.store.list<Share>({ prefix: "share:" });
  for (const s of all.values()) if (s.parts.some((p) => p.invoiceId === invoiceId)) return s;
  return undefined;
}

/** A webhook said something about one of our invoices. Code re-reads it with GET before believing it. */
export async function onInvoiceEvent(ctx: Ctx, invoiceId: string, eventType: string): Promise<void> {
  const share = await findShareByInvoice(ctx, invoiceId);
  if (!share) return;
  await addLog(ctx, { kind: "webhook", note: eventType, ids: [invoiceId] });
  await refreshShare(ctx, share);
  await maybeDraftPot(ctx, share.round);
}

/** When every share of a round reads paid in PayPal, code drafts the pot release for the two confirmers. */
export async function maybeDraftPot(ctx: Ctx, round: number): Promise<boolean> {
  const c = await loadCircle(ctx);
  const pot = await ensurePot(ctx, c, round);
  if (pot.status !== "waiting") return false;
  const shares = await sharesOfRound(ctx, round);
  if (shares.length < c.members.length) return false;
  const allPaid = c.members.every((m) => shareFullyPaid(shares.find((s) => s.memberId === m.id), c.shareCents));
  if (!allPaid) return false;
  pot.status = "drafted";
  await ctx.store.put(keys.pot(round), pot);
  const who = memberById(c, pot.recipientId)?.name || pot.recipientId;
  await addLog(ctx, { kind: "rule", note: `round ${round} fully paid; pot release drafted for ${who}, waiting for two confirmers` });
  return true;
}

export async function recordCashShare(ctx: Ctx, round: number, memberId: string): Promise<Result> {
  const share = await getShare(ctx, round, memberId);
  if (!share) return { ok: false, error: "no share for that member in that round" };
  if (await checkoutBlocksReplacement(ctx, share)) return { ok: false, error: CHECKOUT_WAIT };
  let recorded = 0;
  for (const part of share.parts) {
    if (!part.invoiceId || part.status === "CANCELLED" || checkoutSettled(part)) continue;
    const r = await recordCash(ctx.pp, part.invoiceId, part.cents, today(ctx), part.requestId + "-cash");
    if (r.status < 200 || r.status >= 300) return { ok: false, error: r.errorName === "CK_DAILY_CAP" ? DAILY_CAP_TEXT : `PayPal refused the cash record (${r.errorName || r.status})` };
    part.paymentMethod = "CASH_RECORD";
    recorded++;
  }
  await refreshShare(ctx, share);
  await maybeDraftPot(ctx, round);
  if (recorded) return { ok: true, recorded };
  const unsent = share.parts.some((p) => p.status === "DRAFT" && !p.invoiceId);
  return { ok: false, error: unsent ? "part of that share is not sent yet; try Start again" : "that share is already paid" };
}

const CHECKOUT_WAIT = "Your checkout still needs to be checked. Do not pay again yet.";

function checkoutSettled(part: SharePart): boolean {
  return partPaid(part) || part.orderState === "captured" && !part.recordPending;
}

export function checkoutPending(part: SharePart): boolean {
  if (checkoutSettled(part)) return false;
  if (part.recordPending) return true;
  return !!(part.orderState && part.orderState !== "closed" || part.orderId && part.orderState !== "closed");
}

// Paid and recorded parts are settled. Other orders require a verified void before replacement.
export async function checkoutBlocksReplacement(ctx: Ctx, share: Share): Promise<boolean> {
  for (const part of share.parts) {
    if (part.status === "CANCELLED" || !checkoutPending(part)) continue;
    if (!part.recordPending && !partPaid(part)) await reconcileCheckout(ctx, share, part);
    if (checkoutPending(part)) return true;
  }
  return false;
}

// A completed order alone does not prove that its capture completed or that its amount matches this invoice.
function completedCapture(body: any, part: SharePart): { id: string; cents: number; at?: string } | undefined {
  const units = body?.purchase_units;
  if (!part.orderId || body?.id !== part.orderId || body?.status !== "COMPLETED" || !Array.isArray(units) || units.length !== 1) return;
  const caps = units[0].payments?.captures;
  if (!Array.isArray(caps) || caps.length !== 1) return;
  const cap = caps[0];
  // PayPal may carry custom_id on the unit, on the capture, or both (the sandbox's card answer moved it on 9 Nov 2026).
  const tags = [units[0].custom_id, cap.custom_id].filter((tag) => tag !== undefined);
  if (!tags.length || tags.some((tag) => tag !== part.number)) return;
  const cents = Math.round(Number(cap.amount?.value) * 100);
  if (!cap.id || cap.status !== "COMPLETED" || cap.amount?.currency_code !== "USD" || cents !== part.cents) return;
  return { id: cap.id, cents, at: cap.create_time };
}

async function rememberCapture(ctx: Ctx, share: Share, part: SharePart, body: unknown): Promise<boolean> {
  const cap = completedCapture(body, part);
  if (!cap) return false;
  part.captureId = cap.id;
  part.capturedCents = cap.cents;
  part.capturedAt = cap.at || ctx.now().toISOString();
  part.recordPending = true;
  part.orderState = "captured";
  part.recordMethod ||= "PAYPAL";
  await ctx.store.put(keys.share(share.round, share.memberId), share);
  return true;
}

async function reconcileCheckout(ctx: Ctx, share: Share, part: SharePart): Promise<void> {
  if (!part.orderId || part.orderState === "closed" || part.recordPending) return;
  const got = await getOrder(ctx.pp, part.orderId);
  if (got.status === 200 && got.body?.id === part.orderId) {
    if (await rememberCapture(ctx, share, part, got.body)) return;
    if (got.orderStatus === "VOIDED" && !got.body?.purchase_units?.some((u: any) => u.payments?.captures?.length)) part.orderState = "closed";
    else if (["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(got.orderStatus || "")) part.orderState = "payable";
    else part.orderState = "unknown";
  } else if (got.status === 404 && got.bodyRead === true && !part.captureId) part.orderState = "closed";
  else part.orderState = "unknown";
  await ctx.store.put(keys.share(share.round, share.memberId), share);
}

/** The fallback way to pay a share: a PayPal checkout order for the unpaid amount. */
export async function startOrderShare(ctx: Ctx, round: number, memberId: string, partNumber?: string): Promise<Result> {
  const stored = await getShare(ctx, round, memberId);
  if (!stored) return { ok: false, error: "that part is not yours or is already paid" };
  const share = await refreshShare(ctx, stored);
  const part = share.parts.find((p) => (partNumber === undefined || p.number === partNumber) && p.invoiceId && p.status !== "CANCELLED" && !checkoutSettled(p));
  if (!part) return { ok: false, error: partNumber === undefined ? "that share is already paid" : "that part is not yours or is already paid" };
  if (part.recordPending) return { ok: false, error: "that part is already paid and is being recorded" };
  if (checkoutPending(part)) {
    if (!part.orderId && part.orderRequest) return sendCheckout(ctx, share, part, true);
    await reconcileCheckout(ctx, share, part);
    if (part.orderState === "payable" && part.orderId && part.orderApproveUrl) return { ok: true, approveUrl: part.orderApproveUrl, orderId: part.orderId };
    // A closed order must be replaced by a new invoice with its own request ids.
    return { ok: false, error: CHECKOUT_WAIT };
  }
  if (part.orderState === "closed") return { ok: false, error: "This checkout is closed. Ask for a new invoice." };
  const c = await loadCircle(ctx);
  part.orderRequest = {
    id: crypto.randomUUID(),
    method: "PAYPAL",
    body: orderRequestBody({
      cents: part.cents,
      customId: part.number,
      returnUrl: `${ctx.baseUrl}/api/orders/return?c=${encodeURIComponent(c.id)}`,
      cancelUrl: `${ctx.baseUrl}/m/${encodeURIComponent(c.id)}/${encodeURIComponent(memberById(c, memberId)!.token)}`,
    }),
  };
  return sendCheckout(ctx, share, part, false);
}

/** Persist the complete intent before every send. A refusal on a replay cannot clear earlier uncertainty. */
async function sendCheckout(ctx: Ctx, share: Share, part: SharePart, replay: boolean): Promise<Result> {
  const request = part.orderRequest!;
  if (request.method === "CARD" && !ctx.pp.base.includes("sandbox")) return { ok: false, error: "test card payments work only in the PayPal sandbox" };
  part.orderState = "creating";
  part.recordMethod = request.method;
  await ctx.store.put(keys.share(share.round, share.memberId), share);
  const order = await sendOrder(ctx.pp, request.body, request.id);
  part.orderId = order.id;
  part.orderApproveUrl = order.approveUrl;
  part.orderState = request.method === "PAYPAL" && order.id && order.approveUrl ? "payable" : "unknown";
  const refused = !replay && !order.id && (order.errorName === "CK_DAILY_CAP" ||
    order.bodyRead === true && !order.hadUncertainAttempt && [400, 401, 403, 404, 422].includes(order.status));
  if (refused) {
    delete part.orderState;
    delete part.orderRequest;
  }
  await ctx.store.put(keys.share(share.round, share.memberId), share);
  if (order.id) await ctx.hub.index("order", order.id, ctx.circleId);
  if (await rememberCapture(ctx, share, part, order.body)) return recordCapturedPart(ctx, share, part);
  if (part.orderState === "payable") return { ok: true, approveUrl: order.approveUrl, orderId: order.id };
  const what = request.method === "CARD" ? "card payment" : "order";
  return { ok: false, error: order.errorName === "CK_DAILY_CAP" ? DAILY_CAP_TEXT :
    `PayPal refused the ${what} (${order.errorName || order.status}). ${refused ? "Try again." : CHECKOUT_WAIT}` };
}

/** The buyer came back, or a capture webhook arrived: capture, then record the payment on the invoice so both agree. */
export async function captureOrderShare(ctx: Ctx, orderId: string): Promise<Result> {
  const all = await ctx.store.list<Share>({ prefix: "share:" });
  for (const share of all.values()) {
    const part = share.parts.find((p) => p.orderId === orderId);
    if (!part) continue;
    if (part.status === "CANCELLED" || part.orderState === "closed") return { ok: false, error: "This invoice was replaced. This checkout cannot be used." };
    if (part.recordPending) return recordCapturedPart(ctx, share, part);
    if (checkoutSettled(part)) return { ok: true, already: true };
    if (!part.invoiceId) return { ok: false, error: "This invoice is no longer payable." };
    const invoice = await getInvoice(ctx.pp, part.invoiceId);
    if (invoice.status !== 200 || !invoice.invoiceStatus) return { ok: false, error: CHECKOUT_WAIT };
    part.status = invoice.invoiceStatus as SharePart["status"];
    part.checkedAt = ctx.now().toISOString();
    await ctx.store.put(keys.share(share.round, share.memberId), share);
    if (!["SENT", "UNPAID", "PAYER_ACTION"].includes(part.status)) return { ok: false, error: "This invoice is no longer payable." };
    await reconcileCheckout(ctx, share, part);
    if (part.recordPending) return recordCapturedPart(ctx, share, part);
    if (part.orderState !== "payable") return { ok: false, error: CHECKOUT_WAIT };
    part.orderState = "capturing";
    await ctx.store.put(keys.share(share.round, share.memberId), share);
    const cap = await captureOrder(ctx.pp, orderId, part.requestId + "-capture");
    if (!(await rememberCapture(ctx, share, part, cap.body))) await reconcileCheckout(ctx, share, part);
    if (!part.recordPending) return { ok: false, error: cap.errorName === "CK_DAILY_CAP" ? DAILY_CAP_TEXT : `the order is not approved yet (${cap.errorName || cap.status}). ${CHECKOUT_WAIT}` };
    return recordCapturedPart(ctx, share, part);
  }
  return { ok: false, error: "unknown order" };
}

/** Recording can wait, but a captured payment must never be offered again. */
async function recordCapturedPart(ctx: Ctx, share: Share, part: SharePart): Promise<Result> {
  const card = part.recordMethod === "CARD";
  const rec = await ctx.pp.request(
    "POST",
    `/v2/invoicing/invoices/${part.invoiceId}/payments`,
    { method: card ? "CREDIT_CARD" : "PAYPAL", payment_date: part.capturedAt!.slice(0, 10), amount: { currency_code: "USD", value: money(part.capturedCents!) }, note: `${card ? "card order" : "order"} ${part.orderId}` },
    { requestId: part.requestId + (card ? "-cardpay" : "-orderpay") },
  );
  if (rec.status < 200 || rec.status >= 300) {
    await addLog(ctx, { kind: "rule", note: `${part.number}: payment received, recording pending (${rec.errorName || `HTTP_${rec.status}`})` });
    return { ok: true, pending: true, note: LINES.paymentRecordPending.en({}), round: share.round, memberId: share.memberId };
  }
  delete part.recordPending;
  part.paymentMethod = card ? "CARD" : "PAYPAL";
  await ctx.store.put(keys.share(share.round, share.memberId), share);
  await refreshShare(ctx, share);
  await maybeDraftPot(ctx, share.round);
  return { ok: true, round: share.round, memberId: share.memberId };
}

export async function retryPendingRecords(ctx: Ctx): Promise<void> {
  const all = await ctx.store.list<Share>({ prefix: "share:" });
  for (const share of all.values()) {
    for (const part of share.parts) {
      if (part.status === "CANCELLED") continue;
      if (!part.recordPending && !partPaid(part) && checkoutPending(part)) await reconcileCheckout(ctx, share, part);
      if (part.recordPending) await recordCapturedPart(ctx, share, part);
    }
  }
}

export async function cancelPart(ctx: Ctx, share: Share, part: SharePart, note: string): Promise<boolean> {
  if (part.recordPending || await checkoutBlocksReplacement(ctx, share)) return false;
  if (!part.invoiceId) {
    part.status = "CANCELLED";
    return true;
  }
  const r = await cancelInvoice(ctx.pp, part.invoiceId, "Share replaced", note, part.requestId + "-cancel");
  if (r.status < 200 || r.status >= 300) return false;
  part.status = "CANCELLED";
  await ctx.store.put(keys.share(share.round, share.memberId), share);
  return true;
}

/**
 * A member pays a share with the PayPal sandbox test card: the money is captured into the sandbox merchant, then the
 * invoice is marked paid by card, so the pot is funded by the shares themselves. Sandbox only.
 */
export async function payShareByTestCard(ctx: Ctx, round: number, memberId: string, partNumber?: string): Promise<Result> {
  if (!ctx.pp.base.includes("sandbox")) return { ok: false, error: "test card payments work only in the PayPal sandbox" };
  const stored = await getShare(ctx, round, memberId);
  if (!stored) return { ok: false, error: "that part is not yours or is already paid" };
  const share = await refreshShare(ctx, stored);
  const part = share.parts.find((p) => (partNumber === undefined || p.number === partNumber) && p.invoiceId && p.status !== "CANCELLED" && !checkoutSettled(p));
  if (!part) return { ok: false, error: partNumber === undefined ? "that share is already paid" : "that part is not yours or is already paid" };
  if (part.recordPending) return { ok: false, error: "that part is already paid and is being recorded" };
  if (checkoutPending(part) || part.orderState === "closed") {
    if (!part.orderId && part.orderRequest) return sendCheckout(ctx, share, part, true);
    return { ok: false, error: CHECKOUT_WAIT };
  }
  part.orderRequest = {
    id: crypto.randomUUID(),
    method: "CARD",
    body: testCardOrderRequestBody({ cents: part.cents, customId: part.number }),
  };
  return sendCheckout(ctx, share, part, false);
}
