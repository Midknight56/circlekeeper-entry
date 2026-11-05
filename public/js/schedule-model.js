// Schedule rules shared by every schedule view (the basic one now, the Bryntum one later).

const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];

/**
 * When a round's pot can start. Each live share part is a predecessor of the pot (finish to start): an unpaid part
 * has not finished, so the pot cannot start before now and keeps moving later; a paid part finished at its paid time.
 */
export function potTiming(round, nowIso) {
  const heldBy = [];
  let lastPaid = 0;
  for (const s of round.shares || []) {
    // Server state uses the full required share, including any missing cancelled balance.
    if (s.state !== undefined && s.state !== "paid") heldBy.push(s.memberId);
    for (const p of (s.parts || []).filter((p) => p.status !== "CANCELLED")) {
      if (PAID.includes(p.status)) lastPaid = Math.max(lastPaid, p.paidAt ? Date.parse(p.paidAt) : 0);
      else if (!heldBy.includes(s.memberId)) heldBy.push(s.memberId);
    }
  }
  const held = heldBy.length > 0;
  const start = round.pot?.waitUntil
    ? `${round.pot.waitUntil}T12:00:00.000Z`
    : held ? new Date(Date.parse(nowIso) + 60_000).toISOString() : new Date(lastPaid || Date.parse(nowIso)).toISOString();
  return { held, heldBy, start };
}
