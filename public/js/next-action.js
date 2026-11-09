const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];

function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function formatNameList(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]}, ${names[2]} and ${names.length - 3} more`;
}

function isFullyPaid(share) {
  if (share.state === "paid") return true;
  const parts = (share.parts || []).filter((p) => p.status !== "CANCELLED");
  return parts.length > 0 && parts.every((p) => PAID.includes(p.status));
}

function isRemainingBalance(share) {
  const parts = (share.parts || []).filter((p) => p.status !== "CANCELLED");
  return parts.length > 1 && parts.some((p) => PAID.includes(p.status));
}

function getRemainingCents(share) {
  const parts = (share.parts || []).filter((p) => p.status !== "CANCELLED");
  if (parts.length > 0) {
    return parts.filter((p) => !PAID.includes(p.status)).reduce((sum, p) => sum + (p.cents || 0), 0);
  }
  return share.balanceCents || 0;
}

export function refusalText(refusal) {
  if (refusal === "NETWORK_POT_LIMIT") {
    return "This network has used today's 3 live pots. This pot was not sent. Try again after 00:00 UTC.";
  }
  if (refusal === "CHECK_BY_HAND") {
    return "This payout may already be with PayPal, so it cannot be sent again from here. Check the PayPal account.";
  }
  if (refusal === "PAYPAL_NOT_ANSWERING") {
    return "PayPal did not answer after many tries. Nothing is sent twice. Try again when PayPal is back.";
  }
  if (refusal === "CK_DAILY_CAP") {
    return "Today's limit for PayPal calls is reached. Try again after 00:00 UTC.";
  }
  return `PayPal refused this payout: ${refusal}`;
}

export function nextAction(state) {
  const nameOf = (memberId) => state.circle?.members?.find((m) => m.id === memberId)?.name || memberId;
  const currentRound = () => state.currentRound || (state.rounds ? (state.rounds.find((r) => r.pot?.status !== "paid") || state.rounds[state.rounds.length - 1]) : null);
  const r = currentRound();

  // 0. A demo pays out round 1 only, so once that pot is paid the demo round is finished.
  const first = (state.rounds || []).find((round) => round.round === 1);
  if (state.circle?.demo && first?.pot?.status === "paid") {
    return {
      title: "Round 1 is paid out",
      detail: `${formatMoney(first.pot.cents)} went to ${nameOf(first.recipientId)}. This demo pays out round 1 only; make your own circle to run more rounds.`,
      members: [],
      tone: "done",
    };
  }

  // 1. Circle in draft
  if (state.circle?.status === "draft") {
    return {
      title: "Review the rules, then Start",
      detail: "Nothing is sent yet. Start sends round 1's shares as PayPal invoices.",
      members: [],
      tone: "act",
    };
  }

  // 2. A split with status === "proposed" in the current round
  const proposedSplit = (state.splits || []).find((s) => s.status === "proposed" && s.round === r?.round);
  if (proposedSplit) {
    const name = nameOf(proposedSplit.memberId);
    return {
      title: `Waiting for ${name} to answer the split`,
      detail: `${name} was offered ${formatMoney(proposedSplit.nowCents)} now and ${formatMoney(proposedSplit.laterCents)} later.`,
      members: [proposedSplit.memberId],
      tone: "wait",
    };
  }

  // 3. A swap with status === "asked"
  const askedSwap = (state.swaps || []).find((s) => s.status === "asked");
  if (askedSwap) {
    const notYes = [askedSwap.from, askedSwap.to].filter((id) => askedSwap.consents?.[id] !== "yes");
    const notYesNames = notYes.map(nameOf).join(" and ");
    const fromName = nameOf(askedSwap.from);
    const toName = nameOf(askedSwap.to);
    return {
      title: `Waiting for ${notYesNames} to answer the swap`,
      detail: `${fromName} and ${toName} swap turns only when both say yes.`,
      members: notYes,
      tone: "wait",
    };
  }

  // 4. Pot waiting and some share is not fully paid
  if (r && r.pot?.status === "waiting") {
    const shares = r.shares || [];
    const unpaidShares = shares.filter((s) => !isFullyPaid(s));
    if (unpaidShares.length > 0) {
      if (unpaidShares.length === 1 && isRemainingBalance(unpaidShares[0])) {
        const s = unpaidShares[0];
        const remainingCents = getRemainingCents(s);
        return {
          title: `Waiting for ${nameOf(s.memberId)}'s remaining ${formatMoney(remainingCents)}`,
          detail: `The pot of ${formatMoney(r.pot.cents)} goes out when every share is fully paid.`,
          members: [s.memberId],
          tone: "wait",
        };
      }
      const count = unpaidShares.length;
      const names = unpaidShares.map((s) => nameOf(s.memberId));
      const label = count === 1 ? "1 share" : `${count} shares`;
      return {
        title: `Waiting for ${label}: ${formatNameList(names)}`,
        detail: `The pot of ${formatMoney(r.pot.cents)} goes out when every share is fully paid.`,
        members: unpaidShares.map((s) => s.memberId),
        tone: "wait",
      };
    }
  }

  // 5. Pot drafted and pot.waitUntil > state.now.slice(0, 10)
  if (r && r.pot?.status === "drafted" && r.pot?.waitUntil && state.now && r.pot.waitUntil > state.now.slice(0, 10)) {
    return {
      title: `The pot can go out on ${formatDay(r.pot.waitUntil)}`,
      detail: "Every share is in. The circle agreed to wait until then.",
      members: [],
      tone: "wait",
    };
  }

  // 6. Pot drafted (confirmers)
  if (r && r.pot?.status === "drafted") {
    const confirmers = state.circle?.rules?.confirmers || [];
    const confirmations = r.pot?.confirmations || [];
    const notConfirmed = confirmers.filter((id) => !confirmations.includes(id));
    const confirmerNames = notConfirmed.map(nameOf).join(" and ");
    const recipientName = nameOf(r.recipientId);
    return {
      title: `Waiting for ${confirmerNames} to confirm the pot`,
      detail: `${confirmations.length} of 2 confirmed. The pot of ${formatMoney(r.pot.cents)} goes to ${recipientName} after both confirm.`,
      members: notConfirmed,
      tone: "act",
    };
  }

  // 7. Pot paying
  if (r && r.pot?.status === "paying") {
    let detail = "Sending to PayPal";
    if (r.pot?.payoutBatchId) {
      detail = `Payout batch ${r.pot.payoutBatchId}${r.pot.itemStatus ? ` · ${r.pot.itemStatus}` : ""}`;
    }
    return {
      title: "PayPal is checking the payout",
      detail,
      members: [],
      tone: "wait",
    };
  }

  // 8. Pot failed
  if (r && r.pot?.status === "failed") {
    return {
      title: "The payout needs attention",
      detail: refusalText(r.pot?.refusal),
      members: [],
      tone: "problem",
    };
  }

  // 9. Every pot paid
  const rounds = state.rounds || [];
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const allPotsPaid = state.circle?.status === "done" || (lastRound && lastRound.pot?.status === "paid");
  if (allPotsPaid) {
    return {
      title: "Every round is paid out",
      detail: "Open a round's receipt below to check money in and money out.",
      members: [],
      tone: "done",
    };
  }

  // 10. Current round's pot paid but later rounds exist
  if (r && r.pot?.status === "paid") {
    return {
      title: `Round ${r.round} is paid out`,
      detail: `${formatMoney(r.pot.cents)} went to ${nameOf(r.recipientId)}.`,
      members: [],
      tone: "done",
    };
  }

  return {
    title: "",
    detail: "",
    members: [],
    tone: "wait",
  };
}
