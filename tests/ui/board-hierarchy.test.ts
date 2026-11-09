import { expect, it } from "vitest";
import { env } from "cloudflare:test";

it("record cash button has quiet styling outside any media block", async () => {
  const response = await (env as any).ASSETS.fetch("http://circlekeeper.test/css/theme.css");
  const css = await response.text();
  const outsideMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const ruleMatch = outsideMedia.match(/button\.quiet[^{]*\{([^}]+)\}/);
  expect(ruleMatch).not.toBeNull();
  const ruleBody = ruleMatch![1];
  expect(ruleBody).toMatch(/border(?:-width)?:\s*(?:none|0)/);
  expect(ruleBody).toMatch(/background:\s*transparent/);
});
