import { expect, it } from "vitest";
import { env } from "cloudflare:test";

it("the diagnostics toggles are shown at every width, since the panels start closed", async () => {
  const response = await (env as any).ASSETS.fetch("http://circlekeeper.test/css/bryntum-board.css");
  const css = await response.text();
  const outsideMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  expect(outsideMedia).toMatch(/\.diagnostic-toggle\s*\{[^}]*display:\s*inline-flex/);
  expect(outsideMedia).not.toMatch(/\.diagnostic-toggle[^{]*\{[^}]*display:\s*none/);
});
