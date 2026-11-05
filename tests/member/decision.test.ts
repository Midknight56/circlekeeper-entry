import { describe, expect, it } from "vitest";
import { memberActionsFor } from "../../public/js/member-actions.js";

function fixture() {
  return {
    circle: { demo: false, status: "active", shareCents: 2000, rules: { shortShare: { allowed: true, minNowCents: 1000 } } },
    now: "2027-01-01T12:00:00Z", splits: [] as any[],
    rounds: [
      { round: 1, recipientId: "ben", date: "2027-01-15", pot: { status: "waiting" }, shares: [{ memberId: "ana", parts: [{ invoiceId: "invoice", cents: 2000, status: "UNPAID" }] }] },
      { round: 2, recipientId: "ana", date: "2027-02-15", pot: { status: "waiting" }, shares: [] },
    ],
  };
}

describe("member action decisions", () => {
  it("hides splitting when the rule forbids it", () => {
    const state = fixture(); state.circle.rules.shortShare.allowed = false;
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(false);
  });
  it("offers one unpaid unsplit share with the rule's limits", () => {
    expect(memberActionsFor(fixture(), { id: "ana" })).toMatchObject({ split: true, swap: true, minNowCents: 1000, maxNowCents: 1999 });
  });
  it("follows the first unpaid pot when the round advances", () => {
    const state = fixture();
    state.rounds[0].pot.status = "paid";
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(false);
    state.rounds[1].shares = structuredClone(state.rounds[0].shares);
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(true);
  });
  it.each(["PAID", "MARKED_AS_PAID", "COMPLETED"])("hides a %s share", (status) => {
    const state = fixture(); state.rounds[0].shares[0].parts[0].status = status;
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(false);
  });
  it.each(["proposed", "pending"])("hides an open %s split", (status) => {
    const state = fixture(); state.splits.push({ round: 1, memberId: "ana", status });
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(false);
  });
  it("hides an already split share and a missing share", () => {
    const state = fixture(); state.rounds[0].shares[0].parts.push({ invoiceId: "second", cents: 1000, status: "UNPAID" });
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(false);
    state.rounds[0].shares = [];
    expect(memberActionsFor(state, { id: "ana" }).split).toBe(false);
  });
  it("hides swaps without a future unpaid turn", () => {
    const state = fixture(); state.rounds[1].pot.status = "paid";
    expect(memberActionsFor(state, { id: "ana" }).swap).toBe(false);
    state.rounds[1].pot.status = "waiting"; state.now = "2027-03-01T00:00:00Z";
    expect(memberActionsFor(state, { id: "ana" }).swap).toBe(false);
  });
  it.each(["draft", "done"])("hides actions in a %s circle", (status) => {
    const state = fixture(); state.circle.status = status;
    expect(memberActionsFor(state, { id: "ana" })).toMatchObject({ split: false, swap: false });
  });
});
