const amount = (cents) => `$${(cents / 100).toFixed(2)}`;

export function showDraftRules(circle) {
  return circle.status === "draft" && !circle.demo;
}

export function rulesSummary(circle) {
  const { shortShare, missed, privacy, confirmers } = circle.rules;
  const members = new Map(circle.members.map((member) => [member.id, member.name]));
  const short = `Short shares are ${shortShare.allowed ? "on" : "off"}; minimum amount now ${amount(shortShare.minNowCents)}.`;
  const missedAction = missed.action === "pot_waits" ? "the pot waits" : "the share moves to the end";
  return [
    `Pay day: ${circle.payDay ?? 15} of each month.`,
    short,
    `If a share is missed, ${missedAction} after ${missed.graceDays} grace days.`,
    `Amounts are ${privacy ? "private" : "shared"}.`,
    `Confirmers: ${confirmers.map((id) => members.get(id) || id).join(" and ")}.`,
    ...(circle.brokenNeeds?.length ? ["Needs we could not meet:", ...circle.brokenNeeds, "Start keeps the rotation shown."] : []),
  ];
}
