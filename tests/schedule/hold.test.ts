import { describe, expect, it } from "vitest";
// @ts-ignore plain JavaScript module shared with the pages
import { potTiming } from "../../public/js/schedule-model.js";
// @ts-ignore plain JavaScript module shared with the pages
import { toProjectData } from "../../public/js/bryntum-data.js";

const NOW = "2026-12-08T12:00:00.000Z";
const round = (parts: { memberId: string; status: string; paidAt?: string }[]) => ({
  round: 1,
  date: "2026-12-15",
  shares: parts.map((p) => ({ memberId: p.memberId, parts: [{ cents: 10000, status: p.status, paidAt: p.paidAt || null }] })),
});

describe("the pot waits for every share", () => {
  it("with one unpaid share, the pot starts later than now and names who holds it", () => {
    const t = potTiming(round([{ memberId: "a", status: "PAID", paidAt: "2026-12-02T10:00:00Z" }, { memberId: "b", status: "SENT" }]), NOW);
    expect(t.held).toBe(true);
    expect(t.heldBy).toEqual(["b"]);
    expect(Date.parse(t.start)).toBeGreaterThanOrEqual(Date.parse(NOW));
  });

  it("once every share is paid, the pot starts at the last payment", () => {
    const t = potTiming(
      round([
        { memberId: "a", status: "PAID", paidAt: "2026-12-02T10:00:00Z" },
        { memberId: "b", status: "MARKED_AS_PAID", paidAt: "2026-12-05T09:30:00Z" },
      ]),
      NOW,
    );
    expect(t.held).toBe(false);
    expect(t.heldBy).toEqual([]);
    expect(t.start).toBe("2026-12-05T09:30:00.000Z");
  });

  it("a cancelled part does not hold the pot", () => {
    const r = round([{ memberId: "a", status: "PAID", paidAt: "2026-12-02T10:00:00Z" }]);
    r.shares[0].parts.push({ cents: 10000, status: "CANCELLED", paidAt: null });
    expect(potTiming(r, NOW).held).toBe(false);
  });

  it("maps a fixed due-date share window and a moving held pot start", () => {
    const state: any = { now: NOW, circle: { members: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }, rounds: [{ ...round([
      { memberId: "a", status: "PAID", paidAt: "2026-12-02T10:00:00Z" }, { memberId: "b", status: "SENT" },
    ]), recipientId: "a", pot: { cents: 20000, status: "waiting" } }] };
    const data = toProjectData(state);
    const share = data.events.find((event: any) => event.kind === "share" && event.memberId === "b");
    const paidShare = data.events.find((event: any) => event.kind === "share" && event.memberId === "a");
    const pot = data.events.find((event: any) => event.kind === "pot");
    expect(share.endDate).toBe("2026-12-15T12:00:00.000Z");
    expect(paidShare.endDate).toBe("2026-12-15T12:00:00.000Z");
    expect(pot.held).toBe(true);
    expect(pot.startDate).toBe(potTiming(state.rounds[0], NOW).start);
    state.now = "2026-12-09T12:00:00.000Z";
    expect(Date.parse(toProjectData(state).events.find((event: any) => event.kind === "pot").startDate)).toBeGreaterThan(Date.parse(pot.startDate));
    state.rounds[0].shares[1].parts[0] = { cents: 10000, status: "PAID", paidAt: "2026-12-09T11:00:00Z" };
    const paid = toProjectData(state);
    expect(paid.events.find((event: any) => event.kind === "pot").held).toBe(false);
    expect(paid.events.find((event: any) => event.kind === "pot").startDate).toBe("2026-12-09T11:00:00.000Z");
  });

  it("does not let a cancelled part hold a mapped pot", () => {
    const state: any = { now: NOW, circle: { members: [{ id: "a", name: "A" }] }, rounds: [{
      ...round([{ memberId: "a", status: "PAID", paidAt: "2026-12-02T10:00:00Z" }]),
      recipientId: "a", pot: { cents: 10000, status: "waiting" },
    }] };
    state.rounds[0].shares[0].parts.push({ cents: 10000, status: "CANCELLED", paidAt: null });
    const data = toProjectData(state);
    expect(data.events.filter((event: any) => event.kind === "share")).toHaveLength(1);
    expect(data.dependencies).toHaveLength(1);
    expect(data.events.find((event: any) => event.kind === "pot").held).toBe(false);
  });
});
