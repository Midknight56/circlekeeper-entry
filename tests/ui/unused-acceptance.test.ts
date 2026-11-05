import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";

class Node {
  children: Node[] = [];
  type = "";
  value = "";
  checked = false;
  hidden = false;
  constructor(public tag: string, public text = "") {}
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren(...children: Node[]) { this.children = children; }
  addEventListener() {}
  reportValidity() { return true; }
}
const descendants = (node: Node): Node[] => [node, ...node.children.flatMap(descendants)];

it("shows the omitted text and requires a deliberate checkbox before saving for Start", async () => {
  const source = await (await (env as any).ASSETS.fetch("https://ck.test/js/draft-rules.js")).text();
  const code = source.replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*\};\r?\n/gm, "").replace("export function draftRules", "function draftRules");
  const post = vi.fn(async () => ({}));
  const draftRules = new Function("el", "post", "showDraftRules", `${code}; return draftRules;`)(
    (tag: string, text: string) => new Node(tag, text), post, () => true,
  );
  const box = new Node("section");
  const panel = draftRules(box, "circle", "organiser");
  const circle = {
    status: "draft", demo: false, members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }], needs: [],
    shareCents: 10000, startMonth: "2026-12", payDay: 25, unused: ["except February."],
    rules: { shortShare: { allowed: true, minNowCents: 5000, laterDays: 14 }, missed: { action: "pot_waits", graceDays: 3 }, privacy: true, confirmers: ["a", "b"] },
  };
  // The page's simple money/month helpers do not affect this interaction.
  // Supply them as globals in this evaluated page module's scope.
  vi.stubGlobal("money", (n: number) => `$${n / 100}`);
  vi.stubGlobal("monthLabel", (s: string) => s);
  try {
    panel.render(circle);
    const nodes = descendants(box);
    expect(nodes.some((n) => n.text === "except February.")).toBe(true);
    const accept = nodes.find((n) => n.type === "checkbox")!;
    expect(accept.checked).toBe(false);
    await expect(panel.save()).rejects.toThrow("Review the unused text");
    expect(post).not.toHaveBeenCalled();
    accept.checked = true;
    await panel.save();
    expect(post).toHaveBeenCalledWith("/api/circles/circle/rules", expect.objectContaining({ k: "organiser", rules: expect.objectContaining({ acceptUnused: true }) }));
  } finally { vi.unstubAllGlobals(); }
});
