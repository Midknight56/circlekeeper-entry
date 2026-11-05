import { describe, expect, it } from "vitest";
import { monthOfRound, solveRotation, type Need, type SolveInput, type SolveResult } from "../../src/circle/solver";

const members = ["keisha", "marisol", "dana", "theo", "amelie", "sam"];
const baseInput = (needs: Need[] = []): SolveInput => ({ memberIds: members, startMonth: "2026-12", needs });
const brokenNeeds = (result: SolveResult): Need[] => {
  if (result.ok) throw new Error("Expected an invalid solve result");
  return result.broken;
};

describe("monthOfRound", () => {
  it("handles year rollover forward", () => {
    expect(monthOfRound("2026-12", 2)).toBe("2027-01");
  });

  it("maps a full year of rounds", () => {
    expect(monthOfRound("2026-01", 12)).toBe("2026-12");
  });
});

describe("solveRotation", () => {
  it("places a wanted month and fills other rounds in member order", () => {
    const result = solveRotation(baseInput([{ memberId: "keisha", kind: "want", month: "2027-02" }]));
    expect(result.ok).toBe(true);
    expect(result.rotation).toEqual([
      { round: 1, memberId: "marisol", month: "2026-12", date: "2026-12-15" },
      { round: 2, memberId: "dana", month: "2027-01", date: "2027-01-15" },
      { round: 3, memberId: "keisha", month: "2027-02", date: "2027-02-15" },
      { round: 4, memberId: "theo", month: "2027-03", date: "2027-03-15" },
      { round: 5, memberId: "amelie", month: "2027-04", date: "2027-04-15" },
      { round: 6, memberId: "sam", month: "2027-05", date: "2027-05-15" },
    ]);
  });

  it("rejects a later conflicting want while preserving the earlier one", () => {
    const keisha: Need = { memberId: "keisha", kind: "want", month: "2027-02" };
    const dana: Need = { memberId: "dana", kind: "want", month: "2027-02" };
    const result = solveRotation(baseInput([keisha, dana]));
    expect(result.ok).toBe(false);
    expect(brokenNeeds(result)).toEqual([dana]);
    expect(result.rotation.find((slot) => slot.memberId === "keisha")?.round).toBe(3);
  });

  it("uses an avoid need to move a member off its default round", () => {
    const result = solveRotation({ memberIds: ["a", "b", "c"], startMonth: "2026-01", needs: [{ memberId: "a", kind: "avoid", month: "2026-01" }] });
    expect(result.ok).toBe(true);
    expect(result.rotation.find((slot) => slot.memberId === "a")?.round).toBe(2);
  });

  it("honors on_or_before and on_or_after together", () => {
    const result = solveRotation({
      memberIds: ["a", "b", "c", "d"], startMonth: "2026-01",
      needs: [
        { memberId: "a", kind: "on_or_before", month: "2026-02" },
        { memberId: "b", kind: "on_or_after", month: "2026-03" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.rotation.find((slot) => slot.memberId === "a")!.round).toBeLessThanOrEqual(2);
    expect(result.rotation.find((slot) => slot.memberId === "b")!.round).toBeGreaterThanOrEqual(3);
  });

  it("marks a need outside the circle as broken", () => {
    const need: Need = { memberId: "keisha", kind: "want", month: "2027-06" };
    const result = solveRotation(baseInput([need]));
    expect(result.ok).toBe(false);
    expect(brokenNeeds(result)).toEqual([need]);
  });

  it("marks a need for an unknown member as broken", () => {
    const need: Need = { memberId: "unknown", kind: "want", month: "2026-12" };
    const result = solveRotation(baseInput([need]));
    expect(result.ok).toBe(false);
    expect(brokenNeeds(result)).toEqual([need]);
  });

  it("uses exact search when a constrained member must move from its earliest feasible round", () => {
    const result = solveRotation({
      memberIds: ["a", "b", "c"], startMonth: "2026-01",
      needs: [
        { memberId: "a", kind: "on_or_before", month: "2026-02" },
        { memberId: "b", kind: "on_or_before", month: "2026-01" },
        { memberId: "c", kind: "want", month: "2026-01" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(brokenNeeds(result)).toEqual([{ memberId: "c", kind: "want", month: "2026-01" }]);
    expect(result.rotation.find((slot) => slot.memberId === "a")?.round).toBe(2);
    expect(result.rotation.find((slot) => slot.memberId === "b")?.round).toBe(1);
  });

  it("returns the same result for repeated identical input", () => {
    const input = baseInput([
      { memberId: "sam", kind: "on_or_after", month: "2027-02" },
      { memberId: "dana", kind: "avoid", month: "2026-12" },
    ]);
    expect(solveRotation(input)).toEqual(solveRotation(input));
  });

  it("assigns every member exactly once to rounds 1 through N", () => {
    const result = solveRotation(baseInput([{ memberId: "theo", kind: "want", month: "2027-05" }]));
    expect(result.rotation).toHaveLength(members.length);
    expect(new Set(result.rotation.map((slot) => slot.memberId)).size).toBe(members.length);
    expect(result.rotation.map((slot) => slot.round)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("throws for invalid member lists and start months", () => {
    expect(() => solveRotation({ memberIds: [], startMonth: "2026-01", needs: [] })).toThrow();
    expect(() => solveRotation({ memberIds: ["a", "a"], startMonth: "2026-01", needs: [] })).toThrow();
    expect(() => solveRotation({ memberIds: ["a"], startMonth: "2026-13", needs: [] })).toThrow();
  });

  it("clamps payDay to 28", () => {
    const result = solveRotation({ memberIds: ["a"], startMonth: "2026-01", needs: [], payDay: 31 });
    expect(result.rotation[0].date).toBe("2026-01-28");
  });

  it("defaults payDay to the fifteenth", () => {
    const result = solveRotation({ memberIds: ["a"], startMonth: "2026-01", needs: [] });
    expect(result.rotation[0].date).toBe("2026-01-15");
  });
});
