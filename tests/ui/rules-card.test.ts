import { expect, it } from "vitest";
import { env } from "cloudflare:test";
import { rulesSummary, showDraftRules } from "../../public/js/rules-summary.js";

it("places the rules card in the right column after member views", async () => {
  const html = await (await (env as any).ASSETS.fetch("http://circlekeeper.test/circle.html")).text();
  const columns = [...html.matchAll(/<div class="col">/g)];
  expect(columns).toHaveLength(2);
  const start = columns[1].index!;
  const end = html.indexOf("    </div>\n  </main>", start);
  const rightColumn = html.slice(start, end);
  expect(rightColumn).toContain('id="links-card"');
  expect(rightColumn.indexOf('id="rules-card"')).toBeGreaterThan(rightColumn.indexOf('id="links-card"'));
});

it("shows draft rules only for an own draft circle", () => {
  expect(showDraftRules({ status: "draft", demo: false })).toBe(true);
  expect(showDraftRules({ status: "active", demo: false })).toBe(false);
  expect(showDraftRules({ status: "draft", demo: true })).toBe(false);
});

it("summarizes the missed share action and names both confirmers", () => {
  const lines = rulesSummary({
    demo: false,
    rules: {
      shortShare: { allowed: true, minNowCents: 2500 },
      missed: { action: "pot_waits", graceDays: 3 },
      privacy: true,
      confirmers: ["a", "b"],
    },
    members: [{ id: "a", name: "Dana" }, { id: "b", name: "Morgan" }],
  });
  expect(lines.join(" ")).toContain("$25.00");
  expect(lines.join(" ")).toContain("pot waits");
  expect(lines.join(" ")).toContain("3 grace days");
  expect(lines.join(" ")).toContain("Dana");
  expect(lines.join(" ")).toContain("Morgan");
});
