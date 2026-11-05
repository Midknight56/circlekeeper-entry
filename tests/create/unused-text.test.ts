import html from "../../public/index.html?raw";
import { describe, expect, it } from "vitest";
import { parseCircleText } from "../../src/circle/words";
import { DEMO_TEXT } from "../../src/demo";

const today = "2026-11-05";

describe("unused text keeps context and ignores understood filler", () => {
  it("reads the greeting, friend list, contribution phrasing and whole grace rule", () => {
    const text = "Hi! We are 5 friends: Ana, Ben, Cara, Dev and Eli. Each person puts in $200 per month starting in January. Pay on the 15th of each month. Amounts are private. Late shares wait 3 days grace.";
    const parsed = parseCircleText(text, today);
    expect(parsed.unused).toEqual([]);
    expect(parsed.members.map((member) => member.name)).toEqual(["Ana", "Ben", "Cara", "Dev", "Eli"]);
    expect(parsed.shareCents).toBe(20000);
    expect(parsed.rules.missed).toEqual({ action: "pot_waits", graceDays: 3 });
  });

  it("reads the demo text without unused text", () => {
    expect(parseCircleText(DEMO_TEXT, today).unused).toEqual([]);
  });

  it("reads the actual description placeholder without unused text", () => {
    const placeholder = /<textarea\b[^>]*\bid="description"[^>]*\bplaceholder="([^"]+)"/.exec(html)?.[1];
    expect(placeholder).toBeTruthy();
    expect(parseCircleText(placeholder!, today).unused).toEqual([]);
  });

  it.each(["friends", "people", "members"])("reads a we-are %s list after a greeting", (group) => {
    const parsed = parseCircleText(`Hello! We are 2 ${group}: Ana and Ben. Thanks, thank you!`, today);
    expect(parsed.unused).toEqual([]);
    expect(parsed.members.map((member) => member.name)).toEqual(["Ana", "Ben"]);
  });

  it.each(["person puts in", "member pays", "one pays in", "one of us gives"])("reads each %s before the amount", (phrase) => {
    const parsed = parseCircleText(`Each ${phrase} $200 per month.`, today);
    expect(parsed.unused).toEqual([]);
    expect(parsed.shareCents).toBe(20000);
  });

  it.each([
    "Pay on the 25th except February.",
    "No short shares unless Sam agrees.",
  ])("keeps the whole clause for an unread exception: %s", (text) => {
    expect(parseCircleText(text, today).unused).toEqual([text]);
  });
});
