import { describe, expect, it } from "vitest";
// @ts-ignore plain JavaScript module shared with the pages
import { moveTurnData, toProjectData } from "../../public/js/bryntum-data.js";
// @ts-ignore JSON fixture is loaded by Vitest.
import sampleData from "../../public/dev/sample-state.json";

describe("moving pot turns in Scheduler Pro data", () => {
  it("changes exactly two pot assignments and preserves every dependency", () => {
    const before: any = toProjectData(sampleData);
    const swap = { from: "theo", to: "sam", fromRound: 3, toRound: 5, status: "applied" };
    const after: any = moveTurnData(before, swap);
    const changes = after.assignments.filter((assignment: any, index: number) => assignment.resource !== before.assignments[index].resource);
    expect(changes.map((assignment: any) => assignment.event).sort()).toEqual(["pot-3", "pot-5"]);
    expect(after.assignments.find((assignment: any) => assignment.event === "pot-3").resource).toBe("sam");
    expect(after.assignments.find((assignment: any) => assignment.event === "pot-5").resource).toBe("theo");
    expect(after.dependencies).toEqual(before.dependencies);
  });
});
