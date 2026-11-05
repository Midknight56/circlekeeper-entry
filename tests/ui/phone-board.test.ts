import { expect, it } from "vitest";
import { env } from "cloudflare:test";

it("keeps schedule text at least 12 px at every width", async () => {
  const response = await (env as any).ASSETS.fetch("http://circlekeeper.test/css/bryntum-board.css");
  const css = await response.text();
  const blocks: string[] = [];
  const media = /@media\s*\(max-width:\s*600px\)\s*\{/g;
  for (const match of css.matchAll(media)) {
    const start = match.index! + match[0].length;
    let depth = 1;
    let end = start;
    while (depth && end < css.length) {
      if (css[end] === "{") depth++;
      if (css[end] === "}") depth--;
      end++;
    }
    blocks.push(css.slice(start, end - 1));
  }
  expect(blocks.length, css).toBeGreaterThan(0);
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const fonts = new Map<string, number>();
  for (const [, selectors, declarations] of rules) {
    if (!selectors.includes("#schedule")) continue;
    for (const size of declarations.matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
      expect(Number(size[1]), selectors.trim()).toBeGreaterThanOrEqual(12);
      for (const selector of selectors.split(",")) fonts.set(selector.trim(), Number(size[1]));
    }
  }
  // Both event text and member names need an explicit readable size.
  expect(fonts.get("#schedule .b-sch-event-content") ?? 0, "phone event text").toBeGreaterThanOrEqual(12);
  expect(fonts.get('#schedule .b-grid-cell[data-column="name"]')).toBeGreaterThanOrEqual(12);
});
