import { describe, expect, it } from "vitest";
import { applyDropRule, extractTokens, splitSentences } from "../../src/ai/drop";

const say = (text: string, refs: string[] = []) => ({ to: "group", text, refs });

describe("drop rule gaps found in review", () => {
  it("keeps $60.00 whole when splitting sentences", () => {
    expect(splitSentences("You owe $60.00 now. Thanks!")).toEqual(["You owe $60.00 now.", "Thanks!"]);
  });

  it("drops $60.00 when the data holds 50.00", () => {
    const r = applyDropRule([say("You owe $60.00 now.", ["c"])], { c: { shareCents: 5000 } }, []);
    expect(r.kept).toEqual([]);
    expect(r.dropped[0].token).toBe("$60.00");
  });

  it("reads French months septembre, octobre, novembre", () => {
    for (const [word, mm] of [["septembre", "09"], ["octobre", "10"], ["novembre", "11"]]) {
      expect(extractTokens(`Ton tour est en ${word}.`, [])).toEqual([{ kind: "date", raw: word, value: mm }]);
    }
  });

  it("reads mars and marzo and march with no number near them", () => {
    expect(extractTokens("Ta part est due en mars.", []).map((t) => t.value)).toEqual(["03"]);
    expect(extractTokens("Tu turno es en marzo.", []).map((t) => t.value)).toEqual(["03"]);
    expect(extractTokens("Your turn is in March.", []).map((t) => t.value)).toEqual(["03"]);
  });

  it("drops a French sentence naming the wrong month", () => {
    const r = applyDropRule([say("Ta part est due en mars.", ["c"])], { c: { date: "2027-04-15" } }, []);
    expect(r.kept).toEqual([]);
  });

  it("still ignores the verb may", () => {
    expect(extractTokens("You may pay early.", [])).toEqual([]);
  });
});

describe("claims that a swap already happened", () => {
  it("drops 'swapped' or 'moved' unless a result says applied", () => {
    const asked = { c: { status: "asked", from: "Sam", to: "Theo" } };
    const applied = { c: { status: "applied", from: "Sam", to: "Theo" } };
    const text = "Sam and Theo swapped turns.";
    expect(applyDropRule([say(text, ["c"])], asked, ["Sam", "Theo"]).kept).toEqual([]);
    expect(applyDropRule([say(text, ["c"])], applied, ["Sam", "Theo"]).kept).toHaveLength(1);
    expect(applyDropRule([say("Theo, your turn moved.", ["c"])], asked, ["Theo"]).kept).toEqual([]);
    expect(applyDropRule([say("Sam y Theo intercambiaron turnos.", ["c"])], asked, ["Sam", "Theo"]).kept).toEqual([]);
    expect(applyDropRule([say("Sam et Theo ont échangé leur tour.", ["c"])], asked, ["Sam", "Theo"]).kept).toEqual([]);
  });
});

describe("accented status words", () => {
  it("reads payé and pagó", () => {
    expect(applyDropRule([say("Ta part est payée.", ["c"])], { c: { status: "UNPAID" } }, []).kept).toEqual([]);
    expect(applyDropRule([say("Ya pagó su parte.", ["c"])], { c: { status: "SENT" } }, []).kept).toEqual([]);
  });
});

describe("received is not backed by the PAID inside UNPAID", () => {
  it("drops 'received' when the only status is UNPAID", () => {
    expect(applyDropRule([say("Sam has received a reminder.", ["c"])], { c: { status: "sent", member: "Sam", reason: "unpaid share" } }, ["Sam"]).kept).toEqual([]);
    expect(applyDropRule([say("Sam's share was received.", ["c"])], { c: { status: "PAID", member: "Sam" } }, ["Sam"]).kept).toHaveLength(1);
  });
});

describe("who and when must match one record", () => {
  const rotation = { c: { rotation: [{ name: "Keisha", month: "2027-02" }, { name: "Marisol", month: "2026-12" }] } };
  it("a month with a year must exist as that exact month", () => {
    expect(applyDropRule([say("The pot moves in December 2027.", ["c"])], rotation, ["Keisha", "Marisol"]).kept).toEqual([]);
    expect(applyDropRule([say("The pot moves in December 2026.", ["c"])], rotation, ["Keisha", "Marisol"]).kept).toHaveLength(1);
  });
  it("one member and a date must sit in the same record", () => {
    expect(applyDropRule([say("Keisha takes the pot in December.", ["c"])], rotation, ["Keisha", "Marisol"]).kept).toEqual([]);
    expect(applyDropRule([say("Keisha takes the pot in February.", ["c"])], rotation, ["Keisha", "Marisol"]).kept).toHaveLength(1);
  });
  it("'your' in a member's own chat means that member", () => {
    const keisha = { to: "member:keisha", text: "Your turn is in December.", refs: ["c"] };
    expect(applyDropRule([keisha], rotation, ["Keisha", "Marisol"], { speakerName: "Keisha" }).kept).toEqual([]);
    expect(applyDropRule([{ ...keisha, text: "Your turn is in February." }], rotation, ["Keisha", "Marisol"], { speakerName: "Keisha" }).kept).toHaveLength(1);
    expect(applyDropRule([{ ...keisha, text: "Ton tour est en décembre." }], rotation, ["Keisha", "Marisol"], { speakerName: "Keisha" }).kept).toEqual([]);
  });
  it("he, she, his, her and him about a member are dropped", () => {
    expect(applyDropRule([say("Sam has a reminder about his share.", ["c"])], { c: { name: "Sam" } }, ["Sam"]).kept).toEqual([]);
    expect(applyDropRule([say("Sam has a reminder about the share.", ["c"])], { c: { name: "Sam" } }, ["Sam"]).kept).toHaveLength(1);
  });
});
