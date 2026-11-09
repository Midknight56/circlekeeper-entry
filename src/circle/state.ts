// The JSON the pages read (docs/API.md). A member sees the group and their own messages, and no tool panel.

import type { Ctx } from "./context";
import { RESEND_AFTER_MS } from "./gate";
import { listMessages } from "./messages";
import { settleRound } from "./settle";
import { buildReceipt, hashReceiptChain } from "./receipt";
import { keys, memberById, partPaid, shareState, type Circle, type LogEntry, type Missed, type Pot, type Share, type Split, type Swap } from "./model";
import type { WebhookRecord } from "./webhook-log";
import { changeText } from "./missed";
import { checkoutPending } from "./shares";
import { swapReason } from "./swap";

export type Viewer = { role: "organiser" } | { role: "member"; memberId: string };

export function viewerFor(c: Circle, k: string | null | undefined): Viewer | null {
  if (!k) return null;
  if (k === c.organiserToken) return { role: "organiser" };
  const m = c.members.find((x) => x.token === k);
  return m ? { role: "member", memberId: m.id } : null;
}

export async function stateFor(ctx: Ctx, c: Circle, viewer: Viewer, treasurer: Record<string, unknown>): Promise<Record<string, unknown>> {
  const privateToOther = (memberId: string) => c.rules.privacy && viewer.role === "member" && viewer.memberId !== memberId;
  const rules = { ...c.rules, missed: c.rules.missed || { graceDays: 3, action: "move_to_end" as const } };
  const shares = [...(await ctx.store.list<Share>({ prefix: "share:" })).values()];
  const pots = [...(await ctx.store.list<Pot>({ prefix: "pot:" })).values()];
  const rounds = [...c.rotation]
    .sort((a, b) => a.round - b.round)
    .map((slot) => {
      const pot = pots.find((p) => p.round === slot.round);
      return {
        round: slot.round,
        month: slot.month,
        date: slot.date,
        recipientId: pot && pot.status !== "waiting" ? pot.recipientId : slot.memberId,
        pot: {
          status: pot?.status || "waiting",
          cents: c.shareCents * c.members.length,
          confirmations: (pot?.confirmations || []).map((x) => x.memberId),
          payoutBatchId: pot?.payoutBatchId || null,
          retrying: pot?.status === "paying" && !pot.payoutBatchId && ((pot.sendTries || 0) >= 2 ||
            !!pot.lastSendAt && ctx.now().getTime() - Date.parse(pot.lastSendAt) >= RESEND_AFTER_MS),
          itemStatus: pot?.itemStatus || null,
          refusal: pot?.refusal || null,
          waitUntil: pot?.waitUntil || null,
        },
        shares: shares
          .filter((s) => s.round === slot.round)
          .map((s) => privateToOther(s.memberId) ? {
            memberId: s.memberId,
            state: shareState(s, c.shareCents),
            partCount: s.parts.filter((p) => p.status !== "CANCELLED").length,
          } : ({
            memberId: s.memberId,
            state: shareState(s, c.shareCents),
            balanceCents: Math.max(0, c.shareCents - s.parts.filter((p) => p.invoiceId && p.status !== "CANCELLED" && !p.recordPending && partPaid(p)).reduce((sum, p) => sum + p.cents, 0)),
            recoveryError: s.recoveryError || null,
            reminded: s.reminders.some((r) => r.sent),
            parts: s.parts.map((p) => ({
              number: p.number,
              cents: p.cents,
              status: p.status,
              invoiceId: p.invoiceId || null,
              dueDate: p.dueDate,
              paidAt: p.paidAt || null,
              ...(viewer.role === "member" && viewer.memberId === s.memberId ? { recordPending: !!p.recordPending, checkoutPending: checkoutPending(p) } : {}),
              // A payer link is shown only to that member and the organiser.
              payerUrl: viewer.role === "organiser" || (viewer.role === "member" && viewer.memberId === s.memberId) ? p.payerUrl || null : null,
            })),
          })),
      };
    });
  const swaps = [...(await ctx.store.list<Swap>({ prefix: "swap:" })).values()].filter(
    (s) => viewer.role === "organiser" || s.from === (viewer as { memberId: string }).memberId || s.to === (viewer as { memberId: string }).memberId,
  );
  const splits = [...(await ctx.store.list<Split>({ prefix: "split:" })).values()].filter(
    (s) => viewer.role === "organiser" || s.memberId === (viewer as { memberId: string }).memberId,
  );
  const missed = [...(await ctx.store.list<Missed>({ prefix: "missed:" })).values()].filter((item) =>
    viewer.role === "organiser" || item.status === "asked" && (item.memberId === viewer.memberId || c.rules.confirmers.includes(viewer.memberId)),
  );
  const changes = [...(await ctx.store.list<{ at: string; text: string }>({ prefix: "change:" })).values()];
  const messages = await listMessages(ctx, viewer.role === "organiser" ? { organiser: true } : { memberId: viewer.memberId });
  const out: Record<string, unknown> = {
    version: 0,
    now: "",
    viewer,
    circle: {
      id: c.id,
      name: c.name,
      currency: c.currency,
      shareCents: c.shareCents,
      startMonth: c.startMonth,
      payDay: c.payDay,
      status: c.status,
      demo: c.demo,
      rules,
      ...(viewer.role === "organiser" ? { unused: c.unused || [], unusedAccepted: c.unusedAccepted || [], brokenNeeds: c.brokenNeeds || [] } : {}),
      members: c.members.map((m) => ({ id: m.id, name: m.name, lang: m.lang })),
      rotation: c.rotation,
      needs: c.needs.map((n) => ({ memberId: n.memberId, kind: n.kind, month: n.month })),
    },
    rounds,
    receipts: await hashReceiptChain(await Promise.all(pots.filter((p) => p.status === "paid").map(async (p) => {
      const settlement = await settleRound(ctx, p.round);
      return buildReceipt({
        round: p.round,
        payoutBatchId: settlement.payoutBatchId,
        itemStatus: settlement.itemStatus,
        paidOutCents: settlement.paidOutCents,
        lines: settlement.lines.map((line) => ({ memberId: line.memberId, parts: line.partDetails.map((part) => ({ invoiceId: part.invoiceId, cents: part.cents, paid: part.paid, method: part.method })) })),
      });
    }))),
    swaps: swaps.map((s) => {
      const canSeeWhy = viewer.role === "organiser" || (viewer.role === "member" && (s.from === viewer.memberId || s.to === viewer.memberId));
      let why = s.why;
      if (canSeeWhy && !why) {
        const { conflict: _c, ...computed } = swapReason(c, s.from, s.to, s.fromRound, s.toRound);
        why = computed;
      } else if (canSeeWhy && why) {
        const { conflict: _c, ...clean } = why;
        why = clean;
      }
      return {
        id: s.id,
        from: s.from,
        to: s.to,
        fromRound: s.fromRound,
        toRound: s.toRound,
        status: s.status,
        consents: s.consents,
        ...(canSeeWhy && why ? { why } : {}),
      };
    }),
    splits: splits.map((s) => ({ id: s.id, round: s.round, memberId: s.memberId, nowCents: s.nowCents, laterCents: s.laterCents, dueDate: s.dueDate, status: s.status })),
    missed: missed.map((item) => viewer.role === "organiser"
      ? { ...item, change: changeText(c, item, "en") }
      : ({ id: item.id, round: item.round, memberId: item.memberId, action: item.action, status: item.status, consents: item.consents,
          change: changeText(c, item, memberById(c, viewer.memberId)?.lang || "en") })),
    messages,
    changes: changes.slice(-20),
    treasurer,
  };
  // The full book stays intact; private receipt views cannot be checked against its hashes.
  if (c.rules.privacy && viewer.role === "member") {
    out.receipts = (out.receipts as Awaited<ReturnType<typeof hashReceiptChain>>).map((receipt) => ({
      ...receipt,
      redacted: true,
      hash: undefined,
      previousHash: undefined,
      lines: receipt.lines.map((line) => {
        if (line.kind !== "share" || !privateToOther(line.memberId)) return line;
        return { kind: line.kind, memberId: line.memberId, part: line.part, paid: line.paid };
      }),
    }));
  }
  if (viewer.role === "organiser") {
    out.whatIf = await ctx.store.get("whatif:current") || null;
    // The organiser shares these links with the members; nobody else sees them.
    out.memberLinks = c.members.map((m) => ({ memberId: m.id, name: m.name, url: `/m/${c.id}/${m.token}` }));
    const log = [...(await ctx.store.list<LogEntry>({ prefix: "log:" })).values()];
    out.log = log.slice(-120).reverse();
    out.webhooks = (await ctx.store.get<WebhookRecord[]>("webhooks") || []).slice().reverse();
    // Settlement of every round whose pot has been sent: in by invoice, out by payout.
    const sent = pots.filter((p) => p.status === "paid" || p.status === "paying").map((p) => p.round);
    out.settlements = await Promise.all(sent.map((r) => settleRound(ctx, r)));
  }
  // The version changes whenever anything a page shows changes, so a page can skip a redraw.
  out.version = fnv(JSON.stringify(out));
  out.now = ctx.now().toISOString();
  return out;
}

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
