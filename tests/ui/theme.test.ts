import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

const modules = import.meta.glob("../../public/**/*.{html,css,js}", { query: "?raw", import: "default", eager: true });
const files = Object.fromEntries(Object.entries(modules).map(([path, value]) => [path, typeof value === "string" ? value : (value as { default?: string }).default || ""])) as Record<string, string>;
const required = ["--c-bg", "--c-surface", "--c-border", "--c-text", "--c-muted", "--c-accent", "--c-paid", "--c-sent", "--c-reminded", "--c-late", "--c-held", "--c-ready"];

describe("public theme", () => {
  it("keeps colour literals in the palette and defines every token", async () => {
    // public/vendor/ holds the Bryntum trial builds (copied by dev/vendor_bryntum.py, ignored by git): not ours.
    for (const [path, source] of Object.entries(files)) if (!path.endsWith("/css/theme.css") && !path.includes("/public/vendor/")) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source).not.toMatch(/\b(?:rgb|hsl)a?\s*\(/i);
    }
    const response = await (env as any).ASSETS.fetch("http://circlekeeper.test/css/theme.css");
    const theme = await response.text();
    for (const name of required) expect(theme).toContain(name);
  });
  it("avoids dash punctuation patterns in visible HTML text", () => {
    for (const [path, source] of Object.entries(files)) if (path.endsWith(".html") && !path.includes("/public/vendor/")) {
      const visible = source.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
      expect(visible).not.toContain(" - "); expect(visible).not.toMatch(/[\u2014\u2013]/);
    }
  });
});
