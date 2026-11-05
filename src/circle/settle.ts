// A round's settlement: what came in by invoice, what went out by payout, and whether they match.

import type { Ctx } from "./context";
import { keys, partPaid, type Pot } from "./model";
import { loadCircle, sharesOfRound } from "./shares";

export interface Settlement {
  round: number;
  potCents: number;
  paidCents: number;
  paidOutCents: number;
  payoutBatchId: string | null;
  itemStatus: string | null;
  balanced: boolean;
  unpaid: string[];
  lines: { memberId: string; parts: number[]; paidCents: number; invoiceIds: string[]; partDetails: { cents: number; invoiceId: string; paid: boolean; method: string }[] }[];
}

export async function settleRound(ctx: Ctx, round: number): Promise<Settlement> {
  const c = await loadCircle(ctx);
  const shares = await sharesOfRound(ctx, round);
  const pot = await ctx.store.get<Pot>(keys.pot(round));
  const lines = c.members.map((m) => {
    const s = shares.find((x) => x.memberId === m.id);
    const live = (s?.parts || []).filter((p) => p.status !== "CANCELLED");
    return {
      memberId: m.id,
      parts: live.map((p) => p.cents),
      paidCents: live.filter(partPaid).reduce((a, p) => a + p.cents, 0),
      invoiceIds: live.map((p) => p.invoiceId || "").filter(Boolean),
      partDetails: live.map((p) => ({ cents: p.cents, invoiceId: p.invoiceId || "", paid: partPaid(p), method: p.paymentMethod || (partPaid(p) ? "PAYPAL" : "UNPAID") })),
    };
  });
  const potCents = c.shareCents * c.members.length;
  const paidCents = lines.reduce((a, l) => a + l.paidCents, 0);
  const paidOutCents = pot?.status === "paid" ? pot.cents : 0;
  const unpaid = lines.filter((l) => l.paidCents < c.shareCents).map((l) => l.memberId);
  return {
    round,
    potCents,
    paidCents,
    paidOutCents,
    payoutBatchId: pot?.payoutBatchId || null,
    itemStatus: pot?.itemStatus || null,
    balanced: paidCents === potCents && paidOutCents === potCents && pot?.itemStatus === "SUCCESS",
    unpaid,
    lines,
  };
}
