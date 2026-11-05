import { describe, expect, it } from "vitest";
import { applyDropRule, extractTokens } from "../../src/ai/drop";

const say = (text: string, refs: string[] = []): { to: string; text: string; refs: string[] } => ({ to: "member:1", text, refs });

describe("applyDropRule", () => {
  it("drops unsupported money and records its raw token", () => {
    const result = applyDropRule([say("You owe $60 this week.")], {}, []);
    expect(result.kept).toEqual([]);
    expect(result.dropped[0]).toMatchObject({ sentence: "You owe $60 this week.", token: "$60" });
  });

  it("backs money using a referenced result's cents", () => {
    expect(applyDropRule([say("You owe $60 this week.", ["call_1"])], { call_1: { amountCents: 6000 } }, []).kept[0]?.text).toBe("You owe $60 this week.");
  });

  it("backs money from amount strings", () => {
    expect(applyDropRule([say("You owe $60.", ["call_1"])], { call_1: { amount: { value: "60.00" } } }, []).kept).toHaveLength(1);
  });

  it("keeps supported sentences and drops unsupported sentences separately", () => {
    const result = applyDropRule([say("Your contribution is recorded. You owe $60.", ["call_1"])], { call_1: { status: "recorded" } }, []);
    expect(result.kept[0]?.text).toBe("Your contribution is recorded.");
    expect(result.dropped[0]?.sentence).toBe("You owe $60.");
  });

  it("requires member names to appear in backing data", () => {
    expect(applyDropRule([say("Amélie is next.")], {}, ["Amélie"]).dropped).toHaveLength(1);
    expect(applyDropRule([say("Amélie is next.", ["c"])], { c: { memberName: "Amélie" } }, ["Amélie"]).kept).toHaveLength(1);
  });

  it("distinguishes paid from unpaid", () => {
    expect(applyDropRule([say("Your part is paid.", ["c"])], { c: { status: "UNPAID" } }, []).dropped).toHaveLength(1);
    expect(applyDropRule([say("Your part is paid.", ["c"])], { c: { status: "PAID" } }, []).kept).toHaveLength(1);
  });

  it("does not treat missing refs as backing", () => {
    expect(applyDropRule([say("You owe $60.", ["missing"])], {}, []).dropped).toHaveLength(1);
  });

  it("keeps sentences without tokens", () => {
    expect(applyDropRule([say("Thanks for being part of the circle!")], {}, []).kept).toHaveLength(1);
  });

  it("avoids treating may as a date without a day or year", () => {
    expect(extractTokens("You may want to check", [])).toEqual([]);
    expect(extractTokens("May 15", []).some((token) => token.kind === "date")).toBe(true);
  });

  it("backs month names from ISO date strings", () => {
    expect(applyDropRule([say("Payment is due in February.", ["c"])], { c: { slot: { date: "2027-02-15" } } }, []).kept).toHaveLength(1);
    expect(applyDropRule([say("Payment is due in February.", ["c"])], { c: { slot: { date: "2027-03-15" } } }, []).dropped).toHaveLength(1);
  });

  it("does not treat bare integers as money", () => {
    expect(extractTokens("round 3 and 6 of us", []).filter((token) => token.kind === "money")).toEqual([]);
  });
});
