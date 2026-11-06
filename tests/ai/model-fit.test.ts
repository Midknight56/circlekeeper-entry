import { expect, it } from "vitest";
import { fitMessages } from "../../src/ai/model";

it("keeps the speaker's words when tool data must be cut", () => {
  const fitted = fitMessages([
    { role: "system", content: "s".repeat(3900) },
    { role: "user", content: 'Message: "Solo tengo 60 esta semana."\n' + "d".repeat(5000) },
  ]);
  expect(fitted.reduce((n, message) => n + message.content.length, 0)).toBeLessThanOrEqual(8000);
  expect(fitted[1].content).toContain("Solo tengo 60 esta semana.");
  expect(fitted[1].content).toMatch(/\.\.\.\(cut\)$/);
});

it("keeps the first user message and latest tool result in the step 2 shape", () => {
  const fitted = fitMessages([
    { role: "system", content: "s".repeat(3900) },
    { role: "user", content: 'Writing to you: {"role":"member","id":"dana"}\nMessage: "Can I take my pot in March 2027?"\n' + "d".repeat(5000) },
    { role: "assistant", content: "a".repeat(300) },
    { role: "user", content: "call_2: " + "t".repeat(1500) },
  ]);
  expect(fitted.reduce((n, message) => n + message.content.length, 0)).toBeLessThanOrEqual(8000);
  expect(fitted).toHaveLength(4);
  expect(fitted[1].content).toContain("Can I take my pot in March 2027?");
  expect(fitted[3].content.startsWith("call_2:")).toBe(true);
});

it("drops oldest reply and tool pairs before trimming, keeping the latest pair", () => {
  const fitted = fitMessages([
    { role: "system", content: "s".repeat(3900) },
    { role: "user", content: 'Writing to you: {"role":"member","id":"dana"}\nMessage: "Can I take my pot in March 2027?"\n' + "d".repeat(5000) },
    { role: "assistant", content: "old reply 1 " + "a".repeat(300) },
    { role: "user", content: "old tool 1 " + "t".repeat(1500) },
    { role: "assistant", content: "old reply 2 " + "a".repeat(300) },
    { role: "user", content: "old tool 2 " + "t".repeat(1500) },
    { role: "assistant", content: "latest reply " + "a".repeat(300) },
    { role: "user", content: "call_latest: " + "t".repeat(1500) },
  ]);
  expect(fitted.reduce((n, message) => n + message.content.length, 0)).toBeLessThanOrEqual(8000);
  expect(fitted[1].content).toContain("Can I take my pot in March 2027?");
  expect(fitted.some(message => message.content.includes("old reply 1"))).toBe(false);
  expect(fitted.some(message => message.content.includes("old tool 2"))).toBe(false);
  expect(fitted.at(-1)?.content.startsWith("call_latest:")).toBe(true);
});
