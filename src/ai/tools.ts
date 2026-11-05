// The treasurer's tools read or propose. The only PayPal write is a reminder for an existing invoice, behind the reminder limit.
// No tool moves money, taps a consent or confirms a pot.

import type { Ctx } from "../circle/context";
import { maybeDraftPot } from "../circle/shares";
import { keys, memberById, partPaid, shareState, type Circle, type Pot, type Share } from "../circle/model";
import { solveRotation, type Need } from "../circle/solver";
import { findSwapPartners, proposeSwap } from "../circle/swap";
import { proposeSplit } from "../circle/split";
import { sendReminder } from "../circle/reminders";
import { previewWhatIf } from "../circle/whatif";
import { applyDropRule, splitSentences } from "./drop";
import { privateMemberClaim } from "../circle/privacy";
import { loadCircle, refreshShare, sharesOfRound } from "../circle/shares";
import type { FinancialFact } from "./facts";

export type Speaker = { role: "organiser" } | { role: "member"; memberId: string };

type ArgSpec = { type: "string" | "number" | "array" | "object"; required?: boolean; enum?: string[] };

export interface ToolDef {
  name: string;
  description: string;
  args: Record<string, ArgSpec>;
  organiserOnly?: boolean;
  run(ctx: Ctx, speaker: Speaker, args: Record<string, any>): Promise<Record<string, unknown>>;
}

const REFRESH_AFTER_MS = 60_000;

export function circleView(c: Circle): Record<string, unknown> {
  return {
    name: c.name,
    currency: c.currency,
    shareCents: c.shareCents,
    potCents: c.shareCents * c.members.length,
    financialFacts: c.rotation.flatMap((slot): FinancialFact[] => [
      { kind: "share_amount", round: slot.round, memberId: slot.memberId, name: memberById(c, slot.memberId)!.name, cents: c.shareCents },
      { kind: "pot_amount", round: slot.round, cents: c.shareCents * c.members.length },
    ]),
    startMonth: c.startMonth,
    status: c.status,
    members: c.members.map((m) => ({ id: m.id, name: m.name, lang: m.lang })),
    rotation: c.rotation.map((s) => ({ round: s.round, memberId: s.memberId, name: memberById(c, s.memberId)?.name, month: s.month, date: s.date, shareCents: c.shareCents })),
    needs: c.needs.map((n) => ({ memberId: n.memberId, name: memberById(c, n.memberId)?.name, kind: n.kind, month: n.month })),
    rules: {
      privacy: c.rules.privacy,
      shortShare: c.rules.shortShare,
      confirmers: c.rules.confirmers.map((id) => ({ id, name: memberById(c, id)?.name })),
    },
  };
}

export async function currentRound(ctx: Ctx, c: Circle): Promise<number> {
  for (const s of [...c.rotation].sort((a, b) => a.round - b.round)) {
    const pot = await ctx.store.get<Pot>(keys.pot(s.round));
    if (!pot || pot.status !== "paid") return s.round;
  }
  return c.rotation.length;
}

export async function roundView(ctx: Ctx, round: number, refresh = true, viewer?: Speaker): Promise<Record<string, unknown>> {
  const c = await loadCircle(ctx);
  const slot = c.rotation.find((s) => s.round === round);
  if (!slot) return { error: `no round ${round}` };
  const shares: Share[] = [];
  for (const s of await sharesOfRound(ctx, round)) {
    const stale = s.parts.some((p) => p.invoiceId && p.status !== "CANCELLED" && (!p.checkedAt || ctx.now().getTime() - Date.parse(p.checkedAt) > REFRESH_AFTER_MS));
    shares.push(refresh && stale ? await refreshShare(ctx, s) : s);
  }
  const pot = await ctx.store.get<Pot>(keys.pot(round));
  const financialFacts: FinancialFact[] = c.members.flatMap((m): FinancialFact[] => {
    const parts = shares.find((s) => s.memberId === m.id)?.parts.filter((p) => p.status !== "CANCELLED") || [];
    const visible = viewer?.role !== "member" || viewer.memberId === m.id;
    const identity = { kind: "member_payment" as const, round, memberId: m.id, name: m.name };
    return [
      { ...identity, ...(visible ? { paidCents: parts.filter(partPaid).reduce((sum, p) => sum + p.cents, 0) } : {}) },
      ...parts.map((p, i) => ({ ...identity, part: i + 1, status: p.status, dueDate: p.dueDate, ...(visible ? { cents: p.cents, paidCents: partPaid(p) ? p.cents : 0 } : {}) })),
    ];
  });
  financialFacts.push(
    { kind: "collected_total", round, collectedCents: shares.flatMap((s) => s.parts).filter((p) => p.status !== "CANCELLED" && partPaid(p)).reduce((sum, p) => sum + p.cents, 0) },
    { kind: "payout", round, recipientId: pot?.recipientId || slot.memberId, name: memberById(c, pot?.recipientId || slot.memberId)!.name, cents: pot?.cents ?? c.shareCents * c.members.length, paidOutCents: pot?.status === "paid" ? pot.cents : 0, status: pot?.status || "waiting" },
  );
  return {
    round,
    month: slot.month,
    potDate: slot.date,
    recipient: { id: slot.memberId, name: memberById(c, slot.memberId)?.name },
    potCents: c.shareCents * c.members.length,
    potStatus: pot?.status || "not started",
    confirmations: (pot?.confirmations || []).map((x) => memberById(c, x.memberId)?.name),
    financialFacts,
    shares: c.members.map((m) => {
      const s = shares.find((x) => x.memberId === m.id);
      return {
        memberId: m.id,
        name: m.name,
        round,
        state: shareState(s, c.shareCents),
        ...(viewer?.role !== "member" || viewer.memberId === m.id ? {
          paidCents: (s?.parts || []).filter((p) => p.status !== "CANCELLED" && partPaid(p)).reduce((sum, p) => sum + p.cents, 0),
        } : {}),
        parts: (s?.parts || []).filter((p) => p.status !== "CANCELLED").map((p, i) => ({
          memberId: m.id, name: m.name, round, part: i + 1, direction: "paid",
          ...(viewer?.role !== "member" || viewer.memberId === m.id ? { cents: p.cents } : {}),
          status: p.status,
          dueDate: p.dueDate,
          paid: partPaid(p),
        })),
        lastReminder: s?.reminders.filter((r) => r.sent).slice(-1)[0]?.at.slice(0, 10) || null,
      };
    }),
  };
}

function asMember(speaker: Speaker, given: unknown): string {
  return speaker.role === "member" ? speaker.memberId : String(given || "");
}

const RULE_TEXT: Record<string, (c: Circle) => string> = {
  short_share: (c) =>
    c.rules.shortShare.allowed
      ? `A member may pay part of a share now (at least ${c.rules.shortShare.minNowCents} cents) and the rest within ${c.rules.shortShare.laterDays} days. The member taps yes before anything changes.`
      : "This circle does not allow short shares.",
  privacy: (c) => (c.rules.privacy ? "Group messages never say how much one member owes." : "Group messages may name amounts."),
  confirmers: (c) =>
    `Two members confirm each pot before it is sent: ${c.rules.confirmers.map((id) => memberById(c, id)?.name).join(" and ")}. ` +
    "Code sends it by PayPal Payouts only when PayPal shows every share of the round PAID and both have tapped Confirm.",
  swaps: () => "Two members may swap turns. Both tap yes before anything moves. A stated need is never broken.",
  reminders: () => "At most one reminder per member every 3 days, and none after a share is paid.",
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_circle",
    description: "The circle: members, languages, rules, the rotation (who takes the pot in which month), stated needs.",
    args: {},
    run: async (ctx) => circleView(await loadCircle(ctx)),
  },
  {
    name: "get_round",
    description: "One round: each share's status as PayPal reports it, the pot status, who receives it.",
    args: { round: { type: "number", required: true } },
    run: async (ctx, s, a) => roundView(ctx, Number(a.round), true, s),
  },
  {
    name: "solve_rotation",
    description: "Tries a rotation with extra needs added (kind: want, avoid, on_or_before, on_or_after; month YYYY-MM). Changes nothing.",
    args: { needs: { type: "array", required: true } },
    run: async (ctx, _s, a) => {
      const c = await loadCircle(ctx);
      const extra: Need[] = (Array.isArray(a.needs) ? a.needs : [])
        .map((n: any) => ({ memberId: String(n.member_id || n.memberId || ""), kind: n.kind, month: String(n.month || "") }))
        .filter((n: Need) => ["want", "avoid", "on_or_before", "on_or_after"].includes(n.kind));
      const r = solveRotation({ memberIds: c.members.map((m) => m.id), startMonth: c.startMonth, payDay: c.payDay, needs: [...c.needs, ...extra] });
      return {
        ok: r.ok,
        reason: r.ok ? undefined : r.reason,
        rotation: r.rotation.map((s) => ({ round: s.round, name: memberById(c, s.memberId)?.name, month: s.month })),
        note: "nothing changed; a new rotation needs every moved member's yes",
      };
    },
  },
  {
    name: "find_swap_partners",
    description: "Who could swap turns with a member for a wanted month (YYYY-MM) without breaking anyone's stated need.",
    args: { member_id: { type: "string", required: true }, wanted_month: { type: "string", required: true } },
    run: async (ctx, s, a) => {
      const c = await loadCircle(ctx);
      const who = asMember(s, a.member_id);
      const slot = c.rotation.find((x) => x.month === String(a.wanted_month));
      if (!slot) return { error: `no round in ${a.wanted_month}` };
      const r = await findSwapPartners(ctx, who, slot.round);
      return { member: memberById(c, who)?.name, wantedMonth: slot.month, partners: r.partners.slice(0, 5) };
    },
  },
  {
    name: "propose_swap",
    description: "Creates a pending swap and sends both members a private ask. Moves nothing: both must tap yes.",
    args: { from_member: { type: "string", required: true }, to_member: { type: "string", required: true }, reason: { type: "string" } },
    run: async (ctx, s, a) => {
      const r = await proposeSwap(ctx, asMember(s, a.from_member), String(a.to_member), a.reason ? String(a.reason).slice(0, 200) : undefined);
      if (!r.ok) return { ok: false, error: r.error };
      const c = await loadCircle(ctx);
      return {
        ok: true,
        status: "PENDING",
        from: memberById(c, r.swap!.from)?.name,
        to: memberById(c, r.swap!.to)?.name,
        fromMonth: c.rotation.find((x) => x.round === r.swap!.fromRound)?.month,
        toMonth: c.rotation.find((x) => x.round === r.swap!.toRound)?.month,
        // One record per person, so a sentence about one of them can be checked against that person alone.
        people: [r.swap!.from, r.swap!.to].map((id) => ({
          name: memberById(c, id)?.name,
          status: "PENDING",
          holds: c.rotation.find((x) => x.memberId === id)?.month,
          wouldTake: c.rotation.find((x) => x.round === (id === r.swap!.from ? r.swap!.toRound : r.swap!.fromRound))?.month,
        })),
        note: "private asks sent; nothing moves until both tap yes",
      };
    },
  },
  {
    name: "propose_split",
    description: "Proposes paying part of a share now and the rest later, by the circle's rule. now_cents is the part paid now, in cents (60 dollars = 6000). The member taps yes before anything changes.",
    args: { round: { type: "number", required: true }, member_id: { type: "string", required: true }, now_cents: { type: "number", required: true } },
    run: async (ctx, s, a) => {
      const who = asMember(s, a.member_id);
      const r = await proposeSplit(ctx, Number(a.round), who, Math.round(Number(a.now_cents)));
      if (!r.ok) return { ok: false, error: r.error };
      const c = await loadCircle(ctx);
      return { ok: true, status: "proposed", member: memberById(c, who)?.name, nowCents: r.split!.nowCents, laterCents: r.split!.laterCents, dueDate: r.split!.dueDate, note: "the member taps yes before any invoice changes" };
    },
  },
  {
    name: "draft_reminder",
    description: "A kind reminder for one member's unpaid share in a round, with the reason. Code sends it only if the rules allow.",
    organiserOnly: true,
    args: {
      member_id: { type: "string", required: true },
      round: { type: "number", required: true },
      tone: { type: "string", enum: ["kind", "gentle", "firm"] },
      reason: { type: "string", required: true },
      text: { type: "string", required: true },
    },
    run: async (ctx, _s, a) => {
      const round = Number(a.round);
      const memberId = String(a.member_id);
      const data = await roundView(ctx, round);
      const c = await loadCircle(ctx);
      const text = splitSentences(String(a.text || "")).filter((sentence) => !privateMemberClaim(c, `member:${memberId}`, sentence)).join(" ");
      const checked = applyDropRule([{ to: `member:${memberId}`, text, refs: ["r"] }], { r: data }, c.members.map((m) => m.name), { speakerName: memberById(c, memberId)?.name });
      const note = checked.kept[0]?.text || "A kind reminder: your share for this round is due soon. Thank you.";
      const r = await sendReminder(ctx, memberId, round, { tone: String(a.tone || "kind"), reason: String(a.reason || "").slice(0, 200), note });
      const name = memberById(await loadCircle(ctx), memberId)?.name;
      const due = (data.shares as { memberId: string; parts: { dueDate: string }[] }[] | undefined)?.find((x) => x.memberId === memberId)?.parts[0]?.dueDate;
      return r.ok
        ? { ok: true, status: "sent", member: name, round, month: data.month, dueDate: due, reason: a.reason }
        : { ok: false, member: name, error: r.error };
    },
  },
  {
    name: "preview_what_if",
    description: "Previews a change: kind leave (member and month YYYY-MM: the member stops paying from that month), join (name of the new member) or need (member, month and need_kind). Shows a ghost schedule beside the real one. Changes nothing and never moves money.",
    organiserOnly: true,
    args: {
      kind: { type: "string", required: true, enum: ["leave", "join", "need"] },
      member: { type: "string" },
      name: { type: "string" },
      month: { type: "string" },
      need_kind: { type: "string", enum: ["want", "avoid", "on_or_before", "on_or_after"] },
    },
    run: async (ctx, _s, a) => {
      const c = await loadCircle(ctx);
      const kind = String(a.kind);
      const memberText = String(a.member || "");
      const memberId = c.members.find((member) => member.id === memberText || member.name.toLowerCase() === memberText.toLowerCase())?.id;
      // A clear refusal names the missing field, so the treasurer can ask again instead of guessing a reason.
      if (kind !== "join" && !memberId) return { ok: false, error: `member is required for ${kind}: one of ${c.members.map((m) => m.name).join(", ")}` };
      if (kind !== "join" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(a.month || ""))) return { ok: false, error: "month is required, as YYYY-MM" };
      if (kind === "join" && !String(a.name || a.member || "").trim()) return { ok: false, error: "name is required for join" };
      const change = kind === "join"
        ? { kind: "join" as const, name: String(a.name || a.member || "").slice(0, 80) }
        : kind === "need"
          ? { kind: "need" as const, memberId: memberId!, needKind: String(a.need_kind || "want") as Need["kind"], month: String(a.month) }
          : { kind: "leave" as const, memberId: memberId!, month: String(a.month) };
      const preview = await previewWhatIf(ctx, change);
      return { ok: true, status: "PREVIEW ONLY", changes: preview.lines.en, money: preview.money.en, people: preview.people, broken: preview.broken, note: "the ghost schedule is on the board; nothing moved" };
    },
  },
  {
    name: "draft_pot_release",
    description: "Asks code to draft a round's pot release. Code checks PayPal; two confirmers must tap before money moves.",
    args: { round: { type: "number", required: true } },
    run: async (ctx, _s, a) => {
      const round = Number(a.round);
      await maybeDraftPot(ctx, round);
      const pot = await ctx.store.get<Pot>(keys.pot(round));
      return { round, potStatus: pot?.status || "not started", note: "money moves only after two confirmers tap and PayPal shows every share paid" };
    },
  },
  {
    name: "explain_rule",
    description: "The circle's own rule text.",
    args: { rule_key: { type: "string", required: true, enum: Object.keys(RULE_TEXT) } },
    run: async (ctx, _s, a) => {
      const f = RULE_TEXT[String(a.rule_key)];
      return f ? { rule: String(a.rule_key), text: f(await loadCircle(ctx)) } : { error: "no such rule" };
    },
  },
];

export function validateAction(action: unknown): { ok: true; tool: ToolDef; args: Record<string, unknown> } | { ok: false; error: string; name: string } {
  if (!action || typeof action !== "object") return { ok: false, error: "no action", name: "" };
  const a = action as { tool?: unknown; args?: unknown };
  const name = String(a.tool || "");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `${name} is not a treasurer tool`, name };
  const args = (a.args && typeof a.args === "object" ? a.args : {}) as Record<string, unknown>;
  for (const [k, spec] of Object.entries(tool.args)) {
    const v = args[k];
    if (v === undefined || v === null || v === "") {
      if (spec.required) return { ok: false, error: `${name} needs ${k}`, name };
      continue;
    }
    const t = Array.isArray(v) ? "array" : typeof v;
    if (spec.type === "number" && !(t === "number" || (t === "string" && !Number.isNaN(Number(v))))) return { ok: false, error: `${k} must be a number`, name };
    if (spec.type === "string" && t !== "string") return { ok: false, error: `${k} must be text`, name };
    if (spec.type === "array" && t !== "array") return { ok: false, error: `${k} must be a list`, name };
    if (spec.enum && !spec.enum.includes(String(v))) return { ok: false, error: `${k} must be one of ${spec.enum.join(", ")}`, name };
  }
  return { ok: true, tool, args };
}

export function toolCatalog(speaker: Speaker): string {
  return TOOLS.filter((t) => !t.organiserOnly || speaker.role === "organiser")
    .map((t) => `- ${t.name}(${Object.entries(t.args).map(([k, s]) => `${k}: ${s.enum ? s.enum.join(" | ") : s.type}${s.required ? "" : "?"}`).join(", ")}): ${t.description}`)
    .join("\n");
}
