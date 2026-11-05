import { describe, expect, it } from "vitest";
import { shouldReconcile, BUSY_FOR_MS } from "../../src/circle/busy";

describe("the 5 minute check only visits busy circles", () => {
  const now = Date.parse("2026-12-05T12:00:00Z");
  it("a circle touched in the last 2 hours is checked", () => {
    expect(shouldReconcile(now, now - 60_000, false)).toBe(true);
    expect(shouldReconcile(now, now - BUSY_FOR_MS + 1000, false)).toBe(true);
  });
  it("a quiet circle is skipped", () => {
    expect(shouldReconcile(now, now - BUSY_FOR_MS - 1000, false)).toBe(false);
    expect(shouldReconcile(now, 0, false)).toBe(false);
  });
  it("a payout still being sent is always checked", () => {
    expect(shouldReconcile(now, 0, true)).toBe(true);
  });
});
