import { describe, expect, it } from "vitest";
import { layout } from "../../public/js/schedule-view-basic.js";
// @ts-ignore plain JavaScript module shared with the pages
import { FINISH_TO_START, toProjectData } from "../../public/js/bryntum-data.js";
// @ts-ignore JSON fixture is loaded by Vitest.
import sampleData from "../../public/dev/sample-state.json";
const sample: any = sampleData;

describe("basic schedule adapter", () => {
  it("maps members, shares, pots, split parts, and statuses", () => {
    const result = layout(sample);
    expect((result as any).monthLabels[0]).toBe("Dec 2026");
    expect((result as any).todayMonth).toBe(sample.rounds.find((round: any) => round.month === sample.now.slice(0, 7))?.month);
    expect(result.rows.map((row) => row.memberId)).toEqual(sample.circle.members.map((member: any) => member.id));
    expect(result.rows).toHaveLength(sample.circle.members.length);
    const shares = result.rows.flatMap((row) => row.chips.filter((chip) => chip.kind === "share"));
    const pots = result.rows.flatMap((row) => row.chips.filter((chip) => chip.kind === "pot"));
    for (const round of sample.rounds) {
      for (const share of round.shares) {
        const chips = shares.filter((chip) => chip.round === round.round && chip.memberId === share.memberId);
        const liveParts = share.parts.filter((part: any) => part.status !== "CANCELLED");
        expect(chips).toHaveLength(liveParts.length);
      }
      expect(pots.filter((chip) => chip.round === round.round && chip.memberId === round.recipientId)).toHaveLength(1);
    }
    expect(shares.filter((chip) => chip.round === 2 && chip.memberId === "marisol")).toHaveLength(2);
    expect(shares.some((chip) => chip.kind === "share" && chip.color === "late")).toBe(true);
    const roundTwoPot = pots.find((chip) => chip.round === 2);
    expect(roundTwoPot?.held).toBe(shares.filter((chip) => chip.round === 2 && chip.color !== "paid").length);
    const cancelledSample = structuredClone(sample);
    const target = cancelledSample.rounds[1].shares[0];
    const before = layout(cancelledSample).rows.flatMap((row) => row.chips).filter((chip) => chip.kind === "share" && chip.round === 2 && chip.memberId === target.memberId).length;
    target.parts.push({ cents: 10, status: "CANCELLED" });
    expect(layout(cancelledSample).rows.flatMap((row) => row.chips).filter((chip) => chip.kind === "share" && chip.round === 2 && chip.memberId === target.memberId)).toHaveLength(before);
  });
});

describe("Bryntum project mapping", () => {
  it("maps one resource per member, live share parts, round pots and finish to start links", () => {
    const result = toProjectData(sample);
    expect(result.resources.map((resource: any) => resource.id)).toEqual(sample.circle.members.map((member: any) => member.id));
    expect(result.resources).toHaveLength(sample.circle.members.length);
    const shares = result.events.filter((event: any) => event.kind === "share");
    const pots = result.events.filter((event: any) => event.kind === "pot");
    expect(shares).toHaveLength(sample.rounds.flatMap((round: any) => round.shares.flatMap((share: any) => share.parts.filter((part: any) => part.status !== "CANCELLED"))).length);
    expect(pots).toHaveLength(sample.rounds.length);
    expect(result.dependencies).toHaveLength(shares.length);
    expect(FINISH_TO_START).toBe(2); // DependencyBaseModel.Type.EndToStart in 7.3.7 declarations
    for (const dependency of result.dependencies) {
      expect(dependency.type).toBe(FINISH_TO_START);
      expect(shares.some((event: any) => event.id === dependency.fromEvent)).toBe(true);
      expect(pots.some((event: any) => event.id === dependency.toEvent)).toBe(true);
    }
    expect(result.assignments.filter((item: any) => item.event.startsWith("pot-"))).toHaveLength(sample.rounds.length);
  });
});
