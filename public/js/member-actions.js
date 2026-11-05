const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];

export function memberActionsFor(state, me) {
  const { circle } = state;
  const rule = circle.rules.shortShare;
  const active = circle.status === "active" && !circle.demo;
  const rounds = [...state.rounds].sort((a, b) => a.round - b.round);
  const round = rounds.find((r) => r.pot.status !== "paid") || rounds.at(-1);
  const shares = (round?.shares || []).filter((s) => s.memberId === me.id);
  const parts = shares.flatMap((s) => s.parts).filter((p) => p.status !== "CANCELLED");
  const open = (state.splits || []).some((s) => s.round === round?.round && s.memberId === me.id && ["proposed", "pending"].includes(s.status));
  return {
    split: active && rule.allowed && shares.length === 1 && parts.length === 1 && !!parts[0].invoiceId && !parts[0].recordPending && !parts[0].checkoutPending && !PAID.includes(parts[0].status) && parts[0].cents === circle.shareCents && !open,
    swap: active && state.rounds.some((r) => r.recipientId === me.id && r.pot.status === "waiting" && `${r.date}T23:59:59Z` > state.now),
    minNowCents: rule.minNowCents,
    maxNowCents: circle.shareCents - 1,
  };
}
