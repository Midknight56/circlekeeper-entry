// Reminders: at most one per member per 3 days, never after the share is paid. Each keeps its reason.

import { remindInvoice } from "../paypal/invoices";
import { DAILY_CAP_TEXT } from "../caps";
import { addLog, today, type Ctx } from "./context";
import { addMsg, dayName, line } from "./messages";
import { keys, memberById, partPaid, type Share } from "./model";
import { getShare, loadCircle, refreshShare, type Result } from "./shares";
import { privateMemberClaim } from "./privacy";
import { splitSentences } from "../ai/drop";

export const REMINDER_GAP_MS = 3 * 24 * 60 * 60 * 1000;

async function lastReminderAt(ctx: Ctx, memberId: string): Promise<number> {
  const all = await ctx.store.list<Share>({ prefix: "share:" });
  let last = 0;
  for (const s of all.values()) {
    if (s.memberId !== memberId) continue;
    for (const r of s.reminders) if (r.sent) last = Math.max(last, Date.parse(r.at));
  }
  return last;
}

export async function sendReminder(
  ctx: Ctx,
  memberId: string,
  round: number,
  r: { tone: string; reason: string; note: string },
): Promise<Result> {
  const c = await loadCircle(ctx);
  if (splitSentences(r.note).some((sentence) => privateMemberClaim(c, `member:${memberId}`, sentence))) {
    return { ok: false, error: "this reminder includes another member's private details" };
  }
  const share = await getShare(ctx, round, memberId);
  if (!share) return { ok: false, error: "no share for that member in that round" };
  await refreshShare(ctx, share);
  const part = share.parts.find((p) => p.status !== "CANCELLED" && !partPaid(p) && p.invoiceId);
  if (!part) return { ok: false, error: "that share is paid; no reminder" };
  const last = await lastReminderAt(ctx, memberId);
  if (last && ctx.now().getTime() - last < REMINDER_GAP_MS) return { ok: false, error: "a reminder went out less than 3 days ago" };
  const res = await remindInvoice(ctx.pp, part.invoiceId!, "A kind reminder", r.note.slice(0, 900), crypto.randomUUID());
  const sent = res.status < 300;
  share.reminders.push({ at: ctx.now().toISOString(), reason: r.reason, tone: r.tone, invoiceId: part.invoiceId!, sent });
  await ctx.store.put(keys.share(round, memberId), share);
  await addLog(ctx, { kind: "rule", note: `reminder ${sent ? "sent" : "refused by PayPal"} to ${memberId}: ${r.reason}` });
  return sent ? { ok: true } : { ok: false, error: res.errorName === "CK_DAILY_CAP" ? DAILY_CAP_TEXT : `PayPal refused the reminder (${res.errorName || res.status})` };
}

/** The daily pass (cron): code templates only, no model call. Returns how many reminders went out. */
export async function dailyReminders(ctx: Ctx): Promise<number> {
  const c = await loadCircle(ctx);
  if (c.status !== "active") return 0;
  const all = await ctx.store.list<Share>({ prefix: "share:" });
  const t = today(ctx);
  let n = 0;
  for (const s of all.values()) {
    const part = s.parts.find((p) => p.status !== "CANCELLED" && !partPaid(p));
    if (!part) continue;
    const daysLeft = Math.round((Date.parse(part.dueDate + "T12:00:00Z") - Date.parse(t + "T12:00:00Z")) / 86400000);
    if (daysLeft > 3) continue;
    const m = memberById(c, s.memberId)!;
    const reason = daysLeft < 0 ? `past due by ${-daysLeft} days` : `due in ${daysLeft} days`;
    const note = line("reminder", m.lang, { name: m.name, due: dayName(part.dueDate, m.lang) });
    const r = await sendReminder(ctx, s.memberId, s.round, { tone: "kind", reason, note });
    if (r.ok) {
      n++;
      await addMsg(ctx, { to: `member:${s.memberId}`, from: "treasurer", kind: "reminder", text: note });
    }
  }
  return n;
}
