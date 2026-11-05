// A short share, by the circle's own rule: the old invoice is cancelled and two are sent, after the member taps yes.

import { addDays, addLog, today, type Ctx } from "./context";
import { addMsg, commaMoney, dayName, line } from "./messages";
import { keys, memberById, money, newId, partPaid, type Share, type SharePart, type Split } from "./model";
import { cancelPart, checkoutBlocksReplacement, getShare, invoiceNumber, issuePart, loadCircle, refreshShare, type Result } from "./shares";

export async function proposeSplit(ctx: Ctx, round: number, memberId: string, nowCents: number): Promise<Result & { split?: Split }> {
  const c = await loadCircle(ctx);
  const rule = c.rules.shortShare;
  if (!rule.allowed) return { ok: false, error: "this circle does not allow short shares" };
  if (!Number.isInteger(nowCents) || nowCents < rule.minNowCents) {
    return { ok: false, error: `the circle's rule asks for at least $${money(rule.minNowCents)} now` };
  }
  if (nowCents >= c.shareCents) return { ok: false, error: "that is the whole share; no split needed" };
  const stored = await getShare(ctx, round, memberId);
  if (!stored) return { ok: false, error: "no share for that member in that round" };
  if (stored.parts.some((p) => p.recordPending)) return { ok: false, error: "your payment went through and is still being recorded" };
  const pending = [...(await ctx.store.list<Split>({ prefix: "split:" })).values()].some(
    (split) => split.round === round && split.memberId === memberId && split.status === "proposed",
  );
  if (pending) return { ok: false, error: "a short share is already waiting for an answer" };
  const share = await refreshShare(ctx, stored);
  if (await checkoutBlocksReplacement(ctx, share)) return { ok: false, error: "Your checkout still needs to be checked. Do not pay again yet." };
  const live = share.parts.filter((p) => p.status !== "CANCELLED");
  if (live.length !== 1 || partPaid(live[0]) || !live[0].invoiceId) return { ok: false, error: "only one unpaid invoice can be split" };
  const split: Split = {
    id: newId(8),
    round,
    memberId,
    nowCents,
    laterCents: c.shareCents - nowCents,
    // The rest is due laterDays after the share's own due date, or after today if that has passed.
    dueDate: addDays(live[0].dueDate > today(ctx) ? live[0].dueDate : today(ctx), rule.laterDays),
    status: "proposed",
    createdAt: ctx.now().toISOString(),
  };
  await ctx.store.put(keys.split(split.id), split);
  const m = memberById(c, memberId)!;
  await addMsg(ctx, {
    to: `member:${memberId}`,
    from: "treasurer",
    kind: "ask",
    text: line("splitAsk", m.lang, {
      now: money(split.nowCents),
      later: money(split.laterCents),
      nowEs: commaMoney(split.nowCents),
      laterEs: commaMoney(split.laterCents),
      due: dayName(split.dueDate, m.lang),
    }),
  });
  await addLog(ctx, { kind: "rule", note: `short share proposed for ${m.name}, round ${round}; waiting for ${m.name}'s tap` });
  return { ok: true, split };
}

export async function consentSplit(ctx: Ctx, splitId: string, memberId: string, answer: "yes" | "no"): Promise<Result> {
  const split = await ctx.store.get<Split>(keys.split(splitId));
  if (!split) return { ok: false, error: "no such split" };
  if (split.memberId !== memberId) return { ok: false, error: "only that member can answer" };
  if (split.status !== "proposed") return { ok: false, error: "already answered" };
  split.consent = answer;
  if (answer === "no") {
    split.status = "declined";
    await ctx.store.put(keys.split(splitId), split);
    return { ok: true };
  }
  const c = await loadCircle(ctx);
  if (!Number.isInteger(split.nowCents) || !Number.isInteger(split.laterCents) || split.nowCents < c.rules.shortShare.minNowCents || split.laterCents <= 0 || split.nowCents + split.laterCents !== c.shareCents) {
    split.status = "failed";
    await ctx.store.put(keys.split(splitId), split);
    return { ok: false, error: "the split amounts do not add up to this share" };
  }
  const share = await refreshShare(ctx, (await getShare(ctx, split.round, memberId)) as Share);
  if (share.parts.some((p) => p.recordPending)) return { ok: false, error: "your payment went through and is still being recorded" };
  if (await checkoutBlocksReplacement(ctx, share)) return { ok: false, error: "Your checkout still needs to be checked. Do not pay again yet." };
  const old =share.parts.find((p) => p.status !== "CANCELLED" && !partPaid(p));
  if (!old) {
    split.status = "failed";
    await ctx.store.put(keys.split(splitId), split);
    return { ok: false, error: "that share is already paid" };
  }
  if (!(await cancelPart(ctx, share, old, "This share is replaced by two smaller invoices."))) {
    return { ok: false, error: "PayPal did not cancel the old invoice; nothing changed" };
  }
  const mk = (cents: number, due: string, suffix: string): SharePart => ({
    cents,
    dueDate: due,
    status: "DRAFT",
    requestId: crypto.randomUUID(),
    number: invoiceNumber(c, split.round, memberId, suffix),
  });
  const a = mk(split.nowCents, old.dueDate < today(ctx) ? today(ctx) : old.dueDate, "-a");
  const b = mk(split.laterCents, split.dueDate, "-b");
  share.parts.push(a, b);
  await ctx.store.put(keys.share(split.round, memberId), share);
  split.status = "pending";
  await ctx.store.put(keys.split(splitId), split);
  return sendSplit(ctx, split, share);
}

export async function retrySplit(ctx: Ctx, splitId: string, memberId: string): Promise<Result> {
  const split = await ctx.store.get<Split>(keys.split(splitId));
  if (!split) return { ok: false, error: "no such split" };
  if (split.memberId !== memberId) return { ok: false, error: "only that member can answer" };
  if (split.status !== "pending") return { ok: false, error: "nothing to retry" };
  const share = await getShare(ctx, split.round, memberId);
  if (!share) return { ok: false, error: "no share for that member in that round" };
  return sendSplit(ctx, split, share);
}

async function sendSplit(ctx: Ctx, split: Split, share: Share): Promise<Result> {
  const c = await loadCircle(ctx);
  const parts = ["-a", "-b"].map((suffix) => share.parts.find((p) => p.number === invoiceNumber(c, split.round, split.memberId, suffix)));
  for (const [i, part] of parts.entries()) {
    if (!part || part.status !== "DRAFT") continue;
    const name = i === 0 ? "first" : "second";
    await issuePart(ctx, c, share, part, `${c.name}: ${name} part of your share`, `${i === 0 ? "First" : "Second"} part of your share.`);
  }
  const unsent = parts.filter((part) => !part?.invoiceId || part.status === "DRAFT" || part.status === "CANCELLED");
  if (unsent.length) {
    await addMsg(ctx, { to: `member:${split.memberId}`, from: "treasurer", kind: "notice", text: line("splitPending", memberById(c, split.memberId)!.lang, {}) });
    await addLog(ctx, { kind: "rule", note: `short share pending for ${memberById(c, split.memberId)!.name}: ${unsent.map((part) => part?.number || "missing part").join(", ")} not sent` });
    return { ok: false, error: "one of the new invoices did not send; try again" };
  }
  split.status = "applied";
  await ctx.store.put(keys.split(split.id), split);
  const memberId = split.memberId;
  const m = memberById(c, memberId)!;
  await addMsg(ctx, {
    to: `member:${memberId}`,
    from: "treasurer",
    kind: "notice",
    text: line("splitDone", m.lang, {
      now: money(split.nowCents),
      later: money(split.laterCents),
      nowEs: commaMoney(split.nowCents),
      laterEs: commaMoney(split.laterCents),
      due: dayName(split.dueDate, m.lang),
    }),
  });
  // The group hears that the plan changed; with privacy on it never hears an amount.
  const groupText = c.rules.privacy
    ? `${m.name}'s share this round is now in two parts, by the circle's short share rule.`
    : `${m.name}'s share this round is now $${money(split.nowCents)} now and $${money(split.laterCents)} by ${split.dueDate}.`;
  await addMsg(ctx, { to: "group", from: "treasurer", kind: "notice", text: groupText });
  await addLog(ctx, { kind: "rule", note: `short share applied for ${m.name}: old invoice cancelled, two sent` });
  return { ok: true };
}
