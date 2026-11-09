import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

describe("film words", () => {
  it("i18n.js card, cardNote, and demoNote do not contain sandbox or test words in en, es, fr", async () => {
    const res = await (env as any).ASSETS.fetch("http://circlekeeper.test/js/i18n.js");
    const text = await res.text();
    const forbidden = /sandbox|test card|tarjeta de prueba|carte test|de prueba|de test|test money/i;

    for (const key of ["card", "cardNote", "demoNote"]) {
      const matches = [...text.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, "g"))];
      expect(matches.length).toBe(3);
      for (const match of matches) {
        expect(match[1]).not.toMatch(forbidden);
      }
    }
  });

  it("circle.js recorded run line does not contain sandbox and still contains recorded run", async () => {
    const res = await (env as any).ASSETS.fetch("http://circlekeeper.test/js/circle.js");
    const text = await res.text();
    const recordedRunLine = text
      .split("\n")
      .find((line: string) => line.includes("Demo: the treasurer's answers are a recorded run."));
    expect(recordedRunLine).toBeDefined();
    expect(recordedRunLine).not.toContain("sandbox");
    expect(recordedRunLine).toContain("recorded run");
  });
});
