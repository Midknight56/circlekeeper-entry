// Choose a future turn whose move to the end preserves every stated need.
export function lateMember(state, round) {
  const c = state.circle;
  const slots = [...c.rotation].sort((a, b) => a.round - b.round);
  for (const own of slots.filter((s) => s.round > round && !c.rules.confirmers.includes(s.memberId))) {
    const tail = slots.filter((s) => s.round >= own.round);
    if (tail.length < 2) continue;
    const moved = [...tail.slice(1), tail[0]];
    const months = new Map(slots.map((s) => [s.memberId, s.month]));
    moved.forEach((s, i) => months.set(s.memberId, tail[i].month));
    if (c.needs.every((n) => {
      const m = months.get(n.memberId);
      return n.kind === "want" ? m === n.month : n.kind === "avoid" ? m !== n.month : n.kind === "on_or_before" ? m <= n.month : m >= n.month;
    })) return own.memberId;
  }
  throw new Error("No allowed late member in the current rotation");
}
