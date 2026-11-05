import { describe, expect, it } from "vitest";
import { parseCircleText, slugId } from "../../src/circle/words";

describe("parseCircleText", () => {
  it("parses a count, amount, start month, need, and missing member names", () => {
    const result = parseCircleText("6 of us, $100 a month from December, Keisha needs the pot in February", "2026-10-23");
    expect(result.count).toBe(6);
    expect(result.shareCents).toBe(10000);
    expect(result.startMonth).toBe("2026-12");
    expect(result.members.map((member) => member.name)).toEqual(["Keisha", "Member 2", "Member 3", "Member 4", "Member 5", "Member 6"]);
    expect(result.needs).toEqual([expect.objectContaining({ name: "Keisha", kind: "want", month: "2027-02" })]);
  });

  it("parses listed people, languages, amount, start, and different needs", () => {
    const result = parseCircleText("Keisha, Marisol, Dana, Theo, Amélie and Sam. $100 each, starting January. Marisol speaks Spanish, Amélie (French). Dana can't take March. Theo needs it by April.", "2026-10-23");
    expect(result.members.map((member) => member.name)).toEqual(["Keisha", "Marisol", "Dana", "Theo", "Amélie", "Sam"]);
    expect(result.members.map((member) => member.lang)).toEqual(["en", "es", "en", "en", "fr", "en"]);
    expect(result.startMonth).toBe("2027-01");
    expect(result.needs).toEqual([
      expect.objectContaining({ name: "Dana", kind: "avoid", month: "2027-03" }),
      expect.objectContaining({ name: "Theo", kind: "on_or_before", month: "2027-04" }),
    ]);
  });

  it("moves before and after constraints to the adjacent month", () => {
    const result = parseCircleText("Keisha needs it before April. Marisol wants it after June.", "2026-10-23");
    expect(result.needs).toEqual([
      expect.objectContaining({ name: "Keisha", kind: "on_or_before", month: "2027-03" }),
      expect.objectContaining({ name: "Marisol", kind: "on_or_after", month: "2027-07" }),
    ]);
  });

  it("does not treat month names as members", () => {
    const result = parseCircleText("December and May are months; Keisha needs February.", "2026-10-23");
    expect(result.members.map((member) => member.name)).toEqual(["Keisha"]);
  });

  it("slugifies accents and resolves clashes", () => {
    expect(slugId("Amélie", new Set())).toBe("amelie");
    expect(slugId("Sam", new Set(["sam"]))).toBe("sam-2");
  });

  it("understands number words and we are counts", () => {
    expect(parseCircleText("six of us", "2026-10-23").count).toBe(6);
    expect(parseCircleText("we are 5", "2026-10-23").count).toBe(5);
  });

  it("reports a missing amount", () => {
    const result = parseCircleText("Keisha and Marisol, starting January", "2026-10-23");
    expect(result.shareCents).toBeNull();
    expect(result.notes).toContain("no share amount found");
  });

  it("resolves a Spanish month in a need", () => {
    const result = parseCircleText("Keisha needs the pot in febrero", "2026-10-23");
    expect(result.needs[0]).toEqual(expect.objectContaining({ name: "Keisha", kind: "want", month: "2027-02" }));
  });

  it("understands count forms", () => {
    for (const phrase of ["6 of us", "we are 6", "6 people", "6 members"]) {
      expect(parseCircleText(phrase, "2026-10-23").count).toBe(6);
    }
  });

  it("uses listed names to determine count when count is absent", () => {
    const result = parseCircleText("Keisha, Marisol, Dana and Theo", "2026-10-23");
    expect(result.count).toBe(4);
    expect(result.members.map((member) => member.name)).toEqual(["Keisha", "Marisol", "Dana", "Theo"]);
  });

  it("does not reduce count when fewer names than members are listed", () => {
    const result = parseCircleText("5 members: Keisha, Marisol", "2026-10-23");
    expect(result.count).toBe(5);
    expect(result.members.map((member) => member.name)).toEqual(["Keisha", "Marisol", "Member 3", "Member 4", "Member 5"]);
  });

  it("uses the number of names when it exceeds the stated count", () => {
    const result = parseCircleText("2 of us: Keisha, Marisol, Dana", "2026-10-23");
    expect(result.count).toBe(3);
  });

  it("parses multiple amount formats", () => {
    expect(parseCircleText("$100.50", "2026-10-23").shareCents).toBe(10050);
    expect(parseCircleText("100 dollars", "2026-10-23").shareCents).toBe(10000);
  });

  it("resolves next month and same-month start", () => {
    expect(parseCircleText("starting next month", "2026-10-23").startMonth).toBe("2026-11");
    expect(parseCircleText("from October", "2026-10-23").startMonth).toBe("2026-10");
  });

  it("parses a French month in a need", () => {
    const result = parseCircleText("Amélie needs it in février", "2026-10-23");
    expect(result.needs[0]).toEqual(expect.objectContaining({ name: "Amélie", month: "2027-02" }));
  });

  it("adds default notes and avoids false names", () => {
    const result = parseCircleText("I and We use PayPal in December", "2026-10-23");
    expect(result.count).toBe(0);
    expect(result.members).toEqual([]);
    expect(result.notes).toContain("how many members?");
    expect(result.notes).toContain("no start month found");
  });
});
