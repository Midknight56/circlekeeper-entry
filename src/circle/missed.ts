// A late share asks the circle's two confirmers before its pot or turn can change.

import { addDays, addLog, today, type Ctx } from "./context";
import { addChange, addMsg, dayName, line, monthName } from "./messages";
import { keys, memberById, newId, partPaid, type Circle, type Lang, type Missed, type Pot, type Share } from "./model";
import type { Slot } from "./solver";
import { loadCircle, refreshShare, saveCircle, type Result } from "./shares";
import { sendReminder } from "./reminders";

const DEFAULT_RULE = { graceDays: 3, action: "move_to_end" as const };
const ruleFor = (c: Circle) => c.rules.missed || DEFAULT_RULE;

/** The confirmers who decide a late share: a late confirmer does not vote on their own share. */
export function deciders(c: Circle, lateMemberId: string): string[] {
  return c.rules.confirmers.filter((id) => id !== lateMemberId);
}

function names(list: string[], lang: Lang): string {
  if (list.length < 2) return list.join("");
  const and = { en: "and", es: "y", fr: "et" }[lang];
  return `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}`;
}

/** The planned change in plain words, made by code from the plan, so every month and name is true. */
export function changeText(c: Circle, missed: Pick<Missed, "round" | "memberId" | "plan">, lang: Lang): string {
  const late = memberById(c, missed.memberId)?.name || missed.memberId;
  const month = (round: number) => monthName(c.rotation.find((slot) => slot.round === round)?.month || "", lang);
  const turns = missed.plan.turns || [];
  if (missed.plan.action === "move_to_end" && turns.length) {
    const from = turns.find((turn) => turn.fromMemberId === missed.memberId)!.round;
    const to = turns.find((turn) => turn.memberId === missed.memberId)!.round;
    const others = names(turns.filter((turn) => turn.memberId !== missed.memberId).map((turn) => memberById(c, turn.memberId)?.name || turn.memberId), lang);
    const many = turns.length > 2;
    return {
      en: `${late}'s turn moves from ${month(from)} to ${month(to)}. ${others} ${many ? "each move" : "moves"} one month earlier.`,
      es: `El turno de ${late} pasa de ${month(from)} a ${month(to)}. ${others} ${many ? "adelantan" : "adelanta"} un mes.`,
      fr: `Le tour de ${late} passe de ${month(from)} à ${month(to)}. ${others} ${many ? "avancent" : "avance"} d'un mois.`,
    }[lang];
  }
  const until = dayName(missed.plan.waitUntil || "", lang);
  return {
    en: `The pot of ${month(missed.round)} waits until ${until}.`,
    es: `El fondo de ${month(missed.round)} espera hasta el ${until}.`,
    fr: `Le fonds de ${month(missed.round)} attend jusqu'au ${until}.`,
  }[lang];
}

async function isOpen(ctx: Ctx, round: number): Promise<boolean> {
  const pot = await ctx.store.get<Pot>(keys.pot(round));
  return !pot || pot.status === "waiting";
}

function needHolds(kind: string, month: string, target: string): boolean {
  if (kind === "want") return month === target;
  if (kind === "avoid") return month !== target;
  if (kind === "on_or_before") return month <= target;
  return month >= target;
}

async function lateShare(ctx: Ctx, round: number, memberId: string): Promise<Share | undefined> {
  const share = await ctx.store.get<Share>(keys.share(round, memberId));
  if (!share) return undefined;
  const grace = ruleFor(await loadCircle(ctx)).graceDays;
  const t = today(ctx);
  return share.parts.some((p) => p.status !== "CANCELLED" && !partPaid(p) && addDays(p.dueDate, grace) < t) ? share : undefined;
}

export async function findMissed(ctx: Ctx): Promise<{ round: number; memberId: string }[]> {
  const c = await loadCircle(ctx);
  const pots = await ctx.store.list<Pot>({ prefix: "pot:" });
  const current = c.rotation.find((slot) => pots.get(keys.pot(slot.round))?.status !== "paid")?.round;
  if (!current) return [];
  const shares = await ctx.store.list<Share>({ prefix: keys.sharesOfRound(current) });
  const grace = ruleFor(c).graceDays;
  return [...shares.values()].filter((share) => share.parts.some((part) =>
    part.status !== "CANCELLED" && !partPaid(part) && addDays(part.dueDate, grace) < today(ctx),
  )).map((share) => ({ round: current, memberId: share.memberId }));
}

async function makePlan(ctx: Ctx, c: Circle, round: number, memberId: string): Promise<{ plan: Missed["plan"]; reason?: string }> {
  const rule = ruleFor(c);
  const fallback = (reason: string) => ({ plan: { action: "pot_waits" as const, waitUntil: addDays(today(ctx), rule.graceDays) }, reason });
  if (rule.action === "pot_waits") return fallback("the circle rule is to let the pot wait");
  const own = c.rotation.find((slot) => slot.memberId === memberId);
  if (!own || !(await isOpen(ctx, own.round))) return fallback("the member's turn is already settled");
  const original: Slot[] = [];
  for (const slot of c.rotation.filter((item) => item.round >= own.round).sort((a, b) => a.round - b.round)) {
    if (await isOpen(ctx, slot.round)) original.push(slot);
  }
  if (original.length < 2) return fallback("the member has no later open turn to move");
  const slots = [...original];
  const member = slots.splice(slots.findIndex((slot) => slot.memberId === memberId), 1)[0];
  slots.push(member);
  const newRound = new Map(slots.map((slot, i) => [slot.memberId, original[i].round]));
  for (const need of c.needs) {
    const round = newRound.get(need.memberId);
    const month = round === undefined ? c.rotation.find((slot) => slot.memberId === need.memberId)?.month : c.rotation.find((slot) => slot.round === round)?.month;
    if (month && !needHolds(need.kind, month, need.month)) {
      return fallback(`${memberById(c, need.memberId)?.name || need.memberId}'s stated need for ${need.month} would not fit`);
    }
  }
  return { plan: { action: "move_to_end", turns: slots.map((slot, i) => ({ round: original[i].round, memberId: slot.memberId, fromMemberId: original[i].memberId })) } };
}

export async function proposeMissed(ctx: Ctx, round: number, memberId: string, checkCtx: Ctx = ctx): Promise<Result & { missed?: Missed }> {
  const c = await loadCircle(ctx);
  if (!memberById(c, memberId) || !(await lateShare(checkCtx, round, memberId))) return { ok: false, error: "that share is not late and open" };
  const records = await ctx.store.list<Missed>({ prefix: "missed:" });
  const existing = [...records.values()].find((missed) => missed.round === round && missed.memberId === memberId && missed.status === "asked");
  if (existing) return { ok: true, missed: existing };
  const { plan, reason } = await makePlan(checkCtx, c, round, memberId);
  const missed: Missed = { id: newId(8), round, memberId, action: plan.action, consents: {}, status: "asked", createdAt: ctx.now().toISOString(), plan, reason };
  await ctx.store.put(keys.missed(missed.id), missed);
  const lateMember = memberById(c, memberId)!;
  const voters = deciders(c, memberId);
  // Each member hears it once, in their own language: the confirmers get the ask, the late member a private line.
  for (const m of c.members) {
    if (m.id === memberId) continue;
    const key = voters.includes(m.id) ? "missedAsk" : "missedNotice";
    await addMsg(ctx, { to: `member:${m.id}`, from: "treasurer", kind: voters.includes(m.id) ? "ask" : "notice", text: line(key, m.lang, { member: lateMember.name, change: changeText(c, missed, m.lang) }) });
  }
  // A fallback reason is only said when the circle's rule was to move the turn.
  const said = ruleFor(c).action === "move_to_end" ? reason || "" : "";
  await addMsg(ctx, { to: "organiser", from: "treasurer", kind: "notice", text: line("missedOrganiser", "en", { member: lateMember.name, change: changeText(c, missed, "en"), reason: said }) });
  await addMsg(ctx, { to: `member:${memberId}`, from: "treasurer", kind: "notice", text: line("missedPrivate", lateMember.lang, {}) });
  await sendReminder(ctx, memberId, round, { tone: "kind", reason: "missed share", note: line("missedPrivate", lateMember.lang, {}) }).catch(() => undefined);
  await addLog(ctx, { kind: "rule", note: `missed share for ${memberId} in round ${round}; ${plan.action} waits for both confirmers` });
  return { ok: true, missed };
}

export async function consentMissed(ctx: Ctx, id: string, memberId: string, answer: "yes" | "no"): Promise<Result & { applied?: boolean }> {
  const missed = await ctx.store.get<Missed>(keys.missed(id));
  if (!missed) return { ok: false, error: "no such missed share ask" };
  const c = await loadCircle(ctx);
  if (!deciders(c, missed.memberId).includes(memberId)) return { ok: false, error: "only the two confirmers can answer" };
  if (missed.status !== "asked") return { ok: false, error: "this ask is already settled" };
  if (answer === "no") {
    missed.consents[memberId] = "no";
    missed.status = "declined";
    await ctx.store.put(keys.missed(id), missed);
    await addMsg(ctx, { to: "organiser", from: "treasurer", kind: "notice", text: line("missedDeclined", "en", { member: memberById(c, missed.memberId)?.name || missed.memberId }) });
    return { ok: true, applied: false };
  }
  missed.consents[memberId] = "yes";
  await ctx.store.put(keys.missed(id), missed);
  if (!deciders(c, missed.memberId).every((confirmer) => missed.consents[confirmer] === "yes")) return { ok: true, applied: false };
  const currentShare = await ctx.store.get<Share>(keys.share(missed.round, missed.memberId));
  if (currentShare) await refreshShare(ctx, currentShare);
  if (!(await lateShare(ctx, missed.round, missed.memberId))) {
    missed.status = "declined";
    missed.reason = "paid before the vote";
    await ctx.store.put(keys.missed(id), missed);
    return { ok: true, applied: false };
  }
  if (missed.action === "pot_waits" && !(await isOpen(ctx, missed.round))) {
    missed.status = "declined";
    missed.reason = "the schedule changed since the ask";
    await ctx.store.put(keys.missed(id), missed);
    return { ok: false, error: "the schedule changed since the ask; nothing moved" };
  }
  for (const turn of missed.plan.turns || []) if (!(await isOpen(ctx, turn.round)) || c.rotation.find((slot) => slot.round === turn.round)?.memberId !== turn.fromMemberId) {
    missed.status = "declined";
    missed.reason = "the schedule changed since the ask";
    await ctx.store.put(keys.missed(id), missed);
    return { ok: false, error: "the schedule changed since the ask; nothing moved" };
  }
  const before = structuredClone(c);
  if (missed.action === "move_to_end") {
    for (const turn of missed.plan.turns || []) c.rotation.find((slot) => slot.round === turn.round)!.memberId = turn.memberId;
    await saveCircle(ctx, c);
    for (const turn of missed.plan.turns || []) {
      const pot = await ctx.store.get<Pot>(keys.pot(turn.round));
      if (pot?.status === "waiting") { pot.recipientId = turn.memberId; await ctx.store.put(keys.pot(turn.round), pot); }
    }
  } else {
    const pot = await ctx.store.get<Pot>(keys.pot(missed.round));
    if (pot) { pot.waitUntil = missed.plan.waitUntil; await ctx.store.put(keys.pot(missed.round), pot); }
  }
  missed.status = "applied";
  await ctx.store.put(keys.missed(id), missed);
  const member = memberById(c, missed.memberId)!;
  // The change line describes the plan against the rotation before it moved, so its months stay the ones asked about.
  await addChange(ctx, `${changeText(before, missed, "en")} The confirmers agreed.`);
  for (const m of c.members) await addMsg(ctx, { to: `member:${m.id}`, from: "treasurer", kind: "notice", text: line("missedDone", m.lang, { change: changeText(before, missed, m.lang) }) });
  await addMsg(ctx, { to: "organiser", from: "treasurer", kind: "notice", text: line("missedDone", "en", { change: changeText(before, missed, "en") }) });
  await addLog(ctx, { kind: "schedule", note: `missed share rule applied for ${member.name} in round ${missed.round}: ${missed.action}` });
  return { ok: true, applied: true };
}

export async function checkMissed(ctx: Ctx): Promise<void> {
  for (const item of await findMissed(ctx)) await proposeMissed(ctx, item.round, item.memberId);
}

export function movePlanLines(c: Circle, missed: Missed): { round: number; memberId: string; month: string }[] {
  return (missed.plan.turns || []).map((turn) => ({ ...turn, month: c.rotation.find((slot) => slot.round === turn.round)?.month || "" }));
}

export function monthLabel(c: Circle, round: number, lang: "en" | "es" | "fr"): string {
  const slot = c.rotation.find((item) => item.round === round);
  return slot ? monthName(slot.month, lang) : "";
}
