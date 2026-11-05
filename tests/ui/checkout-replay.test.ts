import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
// @ts-ignore shared page module
import { balanceLines } from "../../public/js/share-balance.js";

class Node {
  children: Node[] = [];
  constructor(public tag: string, public text = "", public click?: () => Promise<void>) {}
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren(...children: Node[]) { this.children = children; }
}

for (const result of [{ ok: true }, { ok: true, pending: true }, { ok: true, approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=original" }]) {
  it(`handles a resumed checkout result without leaving for an absent approval URL: ${JSON.stringify(result)}`, async () => {
    const source = await (await (env as any).ASSETS.fetch("https://ck.test/js/member.js")).text();
    const code = source.slice(source.indexOf("function renderShares("), source.indexOf("function renderAsks("));
    const box = new Node("section");
    const post = vi.fn(async () => result);
    const location = { assign: vi.fn() };
    const notice = { textContent: "" };
    const state = { rounds: [{ round: 1, shares: [{ memberId: "sam", parts: [{ number: "part-a", cents: 6000, status: "SENT", checkoutPending: true }] }] }] };
    const render = new Function("state", "t", "document", "el", "button", "money", "dayLabel", "post", "location", "notice", "id", "token", "lang", "PAID", "balanceLines", `${code}; return renderShares;`)(
      state, { due: String, checkout: "Resume checkout", checkoutPending: "Check checkout", paymentRecordPending: "Recording payment" },
      { querySelector: () => box }, (tag: string, text: string) => new Node(tag, text),
      (label: string, click: () => Promise<void>) => new Node("button", label, click),
      String, String, post, location, notice, "c1", "member-key", "en", ["PAID", "MARKED_AS_PAID", "COMPLETED"], balanceLines,
    );
    render({ id: "sam" });
    const button = box.children[0].children.find((node) => node.tag === "button")!;
    await button.click!();
    expect(post).toHaveBeenCalledWith("/api/circles/c1/shares/1/sam/order", { k: "member-key", part: "part-a" });
    if ("approveUrl" in result) expect(location.assign).toHaveBeenCalledWith(result.approveUrl);
    else expect(location.assign).not.toHaveBeenCalled();
    if ("pending" in result) expect(notice.textContent).toBe("Recording payment");
  });
}
