import { describe, expect, it } from "vitest";
import wranglerRaw from "../../wrangler.jsonc?raw";
import {
  MODEL_ID,
  MAX_CIRCLES_PER_VISITOR_DAY,
  MAX_LIVE_POTS_PER_VISITOR_DAY,
  MAX_PAYPAL_WRITES_PER_CIRCLE_DAY,
  MAX_AI_CALLS_PER_VISITOR_DAY,
  MAX_MEMBERS,
} from "../../src/caps";

export function loadReviewPackage(): string {
  const matches = import.meta.glob("../../docs/REVIEW-PACKAGE.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const content = Object.values(matches)[0];
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    expect.fail("docs/REVIEW-PACKAGE.md is missing or empty");
  }
  return content;
}

export function parseWranglerVars(raw: string): Record<string, string> {
  expect(raw, "wrangler.jsonc must not be empty").toBeTruthy();
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(stripped);
  expect(parsed.vars, "wrangler.jsonc must contain vars").toBeDefined();
  return parsed.vars;
}

export function parseDemoConfig(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  const match = markdown.match(/##\s+Demo configuration\b([\s\S]*?)(?=\r?\n##\s|$)/i);
  expect(match, "docs/REVIEW-PACKAGE.md must contain '## Demo configuration' heading").not.toBeNull();

  const lines = match![1].split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const parts = trimmed.split("|").slice(1, -1).map((s) => s.trim());
    if (parts.length < 2) continue;
    const [rawKey, rawVal] = parts;
    if (/^:?-+:?$/.test(rawKey)) continue;
    if (rawKey.toLowerCase() === "setting") continue;

    const key = rawKey.replace(/^`+|`+$/g, "").trim();
    const val = rawVal.replace(/^`+|`+$/g, "").trim();
    map.set(key, val);
  }
  return map;
}

export function assertDemoConfig(map: Map<string, string>, vars: Record<string, string>): void {
  const expectedLiveAi = vars.LIVE_AI === "1" ? "on" : "off";

  const expectedSettings: Record<string, string | number> = {
    "Live model replies": expectedLiveAi,
    "Model": MODEL_ID,
    "New circles per visitor per day": MAX_CIRCLES_PER_VISITOR_DAY,
    "Live pots per visitor per day": MAX_LIVE_POTS_PER_VISITOR_DAY,
    "PayPal calls per circle per day": MAX_PAYPAL_WRITES_PER_CIRCLE_DAY,
    "Model calls per visitor per day": MAX_AI_CALLS_PER_VISITOR_DAY,
    "Members per circle": MAX_MEMBERS,
    "PayPal base": vars.PAYPAL_BASE,
  };

  for (const [setting, expected] of Object.entries(expectedSettings)) {
    expect(map.has(setting), `Row "${setting}" must exist in ## Demo configuration table`).toBe(true);
    const actual = map.get(setting)!;
    if (typeof expected === "number") {
      const num = Number(actual.replace(/,/g, ""));
      expect(num, `Setting "${setting}" numeric value`).toBe(expected);
    } else {
      expect(actual, `Setting "${setting}" string value`).toBe(expected);
    }
  }
}

export function assertMetadata(markdown: string): void {
  const commitMatch = markdown.match(/^\s*(?:\*\*)?Published commit:(?:\*\*)?\s*`?([0-9a-fA-F]{7,40})`?\s*$/m);
  expect(commitMatch, "Published commit line matching 7 to 40 hex characters must exist").not.toBeNull();

  const dateMatch = markdown.match(/^\s*(?:\*\*)?Date:(?:\*\*)?\s*`?(\d{4}-\d{2}-\d{2})`?\s*$/m);
  expect(dateMatch, "Date line matching YYYY-MM-DD must exist").not.toBeNull();
}

describe("review package", () => {
  it("keeps the review packet true to code", () => {
    const rawPacket = loadReviewPackage();
    const vars = parseWranglerVars(wranglerRaw);
    const map = parseDemoConfig(rawPacket);

    assertDemoConfig(map, vars);
    assertMetadata(rawPacket);
  });
});
