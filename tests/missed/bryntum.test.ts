import { describe, expect, it } from "vitest";
// @ts-ignore plain JavaScript module shared with the pages
import { toProjectData } from "../../public/js/bryntum-data.js";
import SAMPLE_JSON from "../../public/dev/sample-state.json";

describe("missed share board preview", () => {
  it("shows dashed ghost pots while asked and starts an applied waiting pot at waitUntil", () => {
    const sample: any = structuredClone(SAMPLE_JSON);
    sample.missed = [{ id: "abc", round: 1, memberId: "theo", status: "asked", action: "move_to_end", plan: {
      action: "move_to_end", turns: [{ round: 4, memberId: "sam" }, { round: 5, memberId: "amelie" }, { round: 6, memberId: "theo" }],
    } }];
    const asked = toProjectData(sample);
    expect(asked.events.filter((event: any) => event.id.startsWith("ghost-missed-"))).toHaveLength(3);
    expect(asked.events.find((event: any) => event.id === "ghost-missed-abc-pot-6").memberId).toBe("theo");

    sample.missed[0].status = "applied";
    sample.rounds.find((round: any) => round.round === 6).pot.waitUntil = "2027-05-19";
    sample.rounds.find((round: any) => round.round === 6).recipientId = "theo";
    const applied = toProjectData(sample);
    expect(applied.events.some((event: any) => event.id.startsWith("ghost-missed-"))).toBe(false);
    expect(applied.events.find((event: any) => event.id === "pot-6").startDate).toBe("2027-05-19T12:00:00.000Z");
  });
});
