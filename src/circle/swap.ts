// Turn swaps. The AI may find partners and propose; only the two members' own taps move the schedule.

import { addLog, type Ctx } from "./context";
import { addChange, addMsg, line, monthName } from "./messages";
import { keys, memberById, newId, type Circle, type Pot, type Swap, type SwapReason } from "./model";
import type { Need } from "./solver";
import { loadCircle, saveCircle, type Result } from "./shares";

function needHolds(n: Need, month: string): boolean {
  switch (n.kind) {
    case "want":
      return month === n.month;
    case "avoid":
      return month !== n.month;
    case "on_or_before":
      return month <= n.month;
    case "on_or_after":
      return month >= n.month;
  }
}

export function needText(c: Circle, n: Need): string {
  const name = memberById(c, n.memberId)?.name || n.memberId;
  const month = monthName(n.month, "en");
  switch (n.kind) {
    case "want":
      return `${name} needs ${month}`;
    case "avoid":
      return `${name} cannot take ${month}`;
    case "on_or_before":
      return `${name} needs a turn by ${month}`;
    case "on_or_after":
      return `${name} needs a turn in ${month} or later`;
  }
}

function monthOf(c: Circle, round: number): string {
  return c.rotation.find((s) => s.round === round)!.month;
}

function fitsAfterSwap(c: Circle, a: string, aNewRound: number, b: string, bNewRound: number): Need | undefined {
  for (const n of c.needs) {
    if (n.memberId === a && !needHolds(n, monthOf(c, aNewRound))) return n;
    if (n.memberId === b && !needHolds(n, monthOf(c, bNewRound))) return n;
  }
  return undefined;
}

export function swapReason(c: Circle, from: string, to: string, fromRound: number, toRound: number): SwapReason {
  const fromMonth = monthOf(c, fromRound);
  const toMonth = monthOf(c, toRound);
  const fromNow = toMonth;
  const toNow = fromMonth;
  const consenters = [from, to];

  const broken = fitsAfterSwap(c, from, toRound, to, fromRound);
  const conflict = broken
    ? {
        memberId: broken.memberId,
        name: memberById(c, broken.memberId)?.name || broken.memberId,
        text: needText(c, broken),
      }
    : undefined;

  const needsKept: { memberId: string; name: string; text: string }[] = [];
  for (const n of c.needs) {
    let month: string | undefined;
    if (n.memberId === from) month = fromNow;
    else if (n.memberId === to) month = toNow;
    else month = c.rotation.find((s) => s.memberId === n.memberId)?.month;
    if (month && needHolds(n, month)) {
      needsKept.push({
        memberId: n.memberId,
        name: memberById(c, n.memberId)?.name || n.memberId,
        text: needText(c, n),
      });
    }
  }

  return {
    fromMonth,
    toMonth,
    fromNow,
    toNow,
    needsKept,
    ...(conflict ? { conflict } : {}),
    consenters,
  };
}

/** A round can still move while its pot has not been drafted or sent. */
async function roundOpen(ctx: Ctx, round: number): Promise<boolean> {
  const pot = await ctx.store.get<Pot>(keys.pot(round));
  return !pot || pot.status === "waiting";
}

export interface Partner {
  memberId: string;
  name: string;
  round: number;
  month: string;
  fits: boolean;
  why?: string;
}

export async function findSwapPartners(ctx: Ctx, memberId: string, wantedRound: number): Promise<{ ok: boolean; partners: Partner[]; error?: string }> {
  const c = await loadCircle(ctx);
  const mine = c.rotation.find((s) => s.memberId === memberId);
  if (!mine) return { ok: false, partners: [], error: "not a member" };
  if (!c.rotation.some((s) => s.round === wantedRound)) return { ok: false, partners: [], error: "no such round" };
  const partners: Partner[] = [];
  const order = [...c.rotation].sort((x, y) => Math.abs(x.round - wantedRound) - Math.abs(y.round - wantedRound));
  for (const s of order) {
    if (s.memberId === memberId) continue;
    const broken = fitsAfterSwap(c, memberId, s.round, s.memberId, mine.round);
    const open = (await roundOpen(ctx, s.round)) && (await roundOpen(ctx, mine.round));
    const name = memberById(c, s.memberId)?.name || s.memberId;
    partners.push({
      memberId: s.memberId,
      name,
      round: s.round,
      month: s.month,
      fits: !broken && open,
      why: !open ? "that round's pot is already settled" : broken ? needText(c, broken) : undefined,
    });
  }
  return { ok: true, partners };
}

export async function proposeSwap(ctx: Ctx, from: string, to: string, reason?: string, requestRound?: number): Promise<Result & { swap?: Swap }> {
  const c = await loadCircle(ctx);
  const a = c.rotation.find((s) => s.memberId === from);
  const b = c.rotation.find((s) => s.memberId === to);
  if (!a || !b || from === to) return { ok: false, error: "both people must be members, and different" };
  if (!(await roundOpen(ctx, a.round)) || !(await roundOpen(ctx, b.round))) return { ok: false, error: "one of those rounds is already settled" };
  const broken = fitsAfterSwap(c, from, b.round, to, a.round);
  if (broken) return { ok: false, error: `that swap breaks a stated need: ${needText(c, broken)}` };
  const open = [...(await ctx.store.list<Swap>({ prefix: "swap:" })).values()].find(
    (s) => s.status === "asked" && [s.from, s.to].some((x) => x === from || x === to),
  );
  if (open) return { ok: false, error: "one of them already has a swap waiting for an answer" };
  const { conflict: _c, ...why } = swapReason(c, from, to, a.round, b.round);
  const swap: Swap = {
    id: newId(8),
    from,
    to,
    fromRound: a.round,
    toRound: b.round,
    consents: {},
    status: "asked",
    createdAt: ctx.now().toISOString(),
    reason,
    requestRound: requestRound || b.round,
    why,
  };
  await ctx.store.put(keys.swap(swap.id), swap);
  const mf = memberById(c, from)!;
  const mt = memberById(c, to)!;
  await addMsg(ctx, {
    to: `member:${to}`,
    from: "treasurer",
    kind: "ask",
    text: line("swapAskTo", mt.lang, { from: mf.name, fromMonth: monthName(a.month, mt.lang), toMonth: monthName(b.month, mt.lang) }),
  });
  await addMsg(ctx, {
    to: `member:${from}`,
    from: "treasurer",
    kind: "ask",
    text: line("swapAskFrom", mf.lang, { to: mt.name, toMonth: monthName(b.month, mf.lang) }),
  });
  await addLog(ctx, { kind: "rule", note: `swap ${swap.id} proposed: ${mf.name} round ${a.round} with ${mt.name} round ${b.round}; asks sent privately` });
  return { ok: true, swap };
}

export async function consentSwap(ctx: Ctx, swapId: string, memberId: string, answer: "yes" | "no"): Promise<Result & { applied?: boolean }> {
  const swap = await ctx.store.get<Swap>(keys.swap(swapId));
  if (!swap) return { ok: false, error: "no such swap" };
  if (swap.from !== memberId && swap.to !== memberId) return { ok: false, error: "only the two members of this swap can answer" };
  if (swap.status !== "asked") return { ok: false, error: "this swap is already settled" };
  swap.consents[memberId] = answer;
  const c = await loadCircle(ctx);
  if (answer === "no") {
    swap.status = "declined";
    await ctx.store.put(keys.swap(swapId), swap);
    const asker = memberById(c, swap.from)!;
    const decliner = memberById(c, memberId)!;
    const declined = [...(await ctx.store.list<Swap>({ prefix: "swap:" })).values()]
      .filter((s) => s.from === swap.from && s.fromRound === swap.fromRound && (s.requestRound || s.toRound) === (swap.requestRound || swap.toRound) && (s.status === "declined" || s.status === "stale"))
      .map((s) => s.to);
    const options = await findSwapPartners(ctx, swap.from, swap.requestRound || swap.toRound);
    const next = options.partners.find((p) => p.fits && !declined.includes(p.memberId));
    await addMsg(ctx, {
      to: `member:${swap.from}`,
      from: "treasurer",
      kind: "notice",
      text: next
        ? line("swapDeclineNext", asker.lang, { decliner: decliner.name, next: next.name })
        : line("swapDeclineLast", asker.lang, { decliner: decliner.name }),
    });
    await addLog(ctx, { kind: "rule", note: `swap ${swapId} asked and declined by ${decliner.name}; schedule unchanged` });
    if (next) await proposeSwap(ctx, swap.from, next.memberId, swap.reason, swap.requestRound || swap.toRound);
    return { ok: true, applied: false };
  }
  await ctx.store.put(keys.swap(swapId), swap);
  if (swap.consents[swap.from] !== "yes" || swap.consents[swap.to] !== "yes") return { ok: true, applied: false };
  // Both tapped yes: re-check, then move the two turns.
  const fromSlot = c.rotation.find((s) => s.round === swap.fromRound);
  const toSlot = c.rotation.find((s) => s.round === swap.toRound);
  if (!fromSlot || !toSlot || fromSlot.memberId !== swap.from || toSlot.memberId !== swap.to ||
      !(await roundOpen(ctx, swap.fromRound)) || !(await roundOpen(ctx, swap.toRound)) ||
      fitsAfterSwap(c, swap.from, swap.toRound, swap.to, swap.fromRound)) {
    swap.status = "stale";
    await ctx.store.put(keys.swap(swapId), swap);
    const fa = memberById(c, swap.from)!;
    const ta = memberById(c, swap.to)!;
    await addChange(ctx, `${fa.name} and ${ta.name}'s swap did not move: the schedule changed before both said yes.`);
    return { ok: false, error: "the schedule changed since the ask; nothing moved" };
  }
  for (const s of c.rotation) {
    if (s.round === swap.fromRound) s.memberId = swap.to;
    else if (s.round === swap.toRound) s.memberId = swap.from;
  }
  await saveCircle(ctx, c);
  for (const [round, who] of [
    [swap.fromRound, swap.to],
    [swap.toRound, swap.from],
  ] as const) {
    const pot = await ctx.store.get<Pot>(keys.pot(round));
    if (pot && pot.status === "waiting") {
      pot.recipientId = who;
      await ctx.store.put(keys.pot(round), pot);
    }
  }
  swap.status = "applied";
  swap.appliedAt = ctx.now().toISOString();
  await ctx.store.put(keys.swap(swapId), swap);
  const fa = memberById(c, swap.from)!;
  const ta = memberById(c, swap.to)!;
  // No clock time in the text: the page adds it from the change's "at", in the viewer's own time zone.
  await addChange(ctx, `${fa.name} and ${ta.name} swapped turns, both agreed`);
  await addMsg(ctx, { to: "group", from: "treasurer", kind: "notice", text: line("swapDone", "en", { a: fa.name, b: ta.name }) });
  await addLog(ctx, { kind: "schedule", note: `moved: ${fa.name} to round ${swap.toRound}, ${ta.name} to round ${swap.fromRound}` });
  return { ok: true, applied: true };
}
