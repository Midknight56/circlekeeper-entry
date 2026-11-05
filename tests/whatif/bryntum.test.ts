import { describe, expect, it } from "vitest";
// @ts-ignore plain JavaScript module shared with the pages
import { toProjectData } from "../../public/js/bryntum-data.js";
import SAMPLE_JSON from "../../public/dev/sample-state.json";

describe("what if schedule preview", () => {
  it("draws a labelled ghost when only the amount changes", () => {
    const state: any = structuredClone(SAMPLE_JSON);
    state.whatIf = { rotation: state.circle.rotation.map((slot: any) => ({ ...slot })), potCentsByRound: { 4: 50000 } };
    const data = toProjectData(state);
    expect(data.events.find((event: any) => event.id === "whatif-pot-4")).toMatchObject({ name: "$500.00", memberId: state.rounds.find((round: any) => round.round === 4).recipientId, ghost: true });
    expect(data.events.filter((event: any) => event.whatIf)).toHaveLength(1);
    expect(data.events.find((event: any) => event.id === "pot-4").name).toBe("$600.00");
  });

  it("adds ghost pots for changed turns and keeps real pots in place", () => {
    const state: any = structuredClone(SAMPLE_JSON);
    const real = state.rounds.map((round: any) => [round.round, round.recipientId]);
    state.whatIf = { rotation: state.circle.rotation.map((slot: any) => ({ ...slot })), potCentsByRound: { 4: 50000 } };
    state.whatIf.rotation.find((slot: any) => slot.round === 4).memberId = "sam";
    const data = toProjectData(state);
    expect(data.events.some((event: any) => event.id.startsWith("whatif-") && event.round === 4)).toBe(true);
    expect(data.events.find((event: any) => event.id === "whatif-pot-4").name).toBe("$500.00");
    expect(data.assignments.find((assignment: any) => assignment.event === "whatif-pot-4").resource).toBe("sam");
    expect(state.rounds.map((round: any) => [round.round, round.recipientId])).toEqual(real);
  });
});
