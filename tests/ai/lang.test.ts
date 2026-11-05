import { describe, expect, it } from "vitest";
import { applyDropRule, extractTokens } from "../../src/ai/drop";

const say = (text: string, refs: string[] = []) => ({ to: "circle", text, refs });

describe("localized tokens", () => {
  it("backs Spanish amounts and dates", () => {
    const text = "Puedes pagar 60,00 $ ahora y 40,00 $ antes del 20 de febrero.";
    const result = applyDropRule([say(text, ["c"])], { c: { nowCents: 6000, laterCents: 4000, dueDate: "2027-02-20" } }, []);
    expect(result.kept[0]?.text).toBe(text);
  });

  it("backs Spanish paid language only with paid status", () => {
    expect(applyDropRule([say("Tu parte está pagada.", ["c"])], { c: { status: "PAID" } }, []).kept).toHaveLength(1);
    expect(applyDropRule([say("Tu parte está pagada.", ["c"])], { c: { status: "UNPAID" } }, []).dropped).toHaveLength(1);
  });

  it("backs French names, amounts and dates", () => {
    const text = "Amélie, ta part de 100,00 $ est due en mars.";
    expect(applyDropRule([say(text, ["c"])], { c: { name: "Amelie", shareCents: 10000, date: "2027-03-15" } }, ["Amelie"]).kept).toHaveLength(1);
    expect(applyDropRule([say(text, ["c"])], { c: { name: "Amelie", shareCents: 9000, date: "2027-03-15" } }, ["Amelie"]).dropped).toHaveLength(1);
  });

  it("matches names without regard to accents", () => {
    expect(extractTokens("Amelie", ["Amélie"])).toContainEqual(expect.objectContaining({ kind: "name", raw: "Amelie" }));
  });
});
