import { describe, expect, it } from "vitest";
import { startCircle, getShare } from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { listMessages } from "../../src/circle/messages";
import { world } from "../helpers/world";

describe("short shares", () => {
  it("with privacy on, the group message holds no amount, and the two new invoices sum to the share", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const old = (await getShare(w.ctx, 1, "marisol"))!.parts[0].invoiceId!;
    const p = await proposeSplit(w.ctx, 1, "marisol", 6000);
    expect(p.ok).toBe(true);
    const id = (p as any).split.id;
    const r = await consentSplit(w.ctx, id, "marisol", "yes");
    expect(r.ok).toBe(true);
    expect(w.sb.invoices.get(old)!.status).toBe("CANCELLED");
    const s = (await getShare(w.ctx, 1, "marisol"))!;
    const live = s.parts.filter((x) => x.status !== "CANCELLED");
    expect(live.map((x) => x.cents)).toEqual([6000, 4000]);
    expect(live.reduce((a, x) => a + x.cents, 0)).toBe(10000);
    for (const x of live) expect(w.sb.invoices.get(x.invoiceId!)!.status).toBe("SENT");
    const group = (await listMessages(w.ctx, { memberId: "keisha" })).filter((m) => m.to === "group");
    expect(group.length).toBeGreaterThan(0);
    for (const m of group) expect(m.text).not.toMatch(/\$|\d+[.,]\d\d|\b60\b|\b40\b/);
  });

  it("refuses a now amount under the circle's minimum, or when the rule is off", async () => {
    const w = await world();
    await startCircle(w.ctx);
    expect((await proposeSplit(w.ctx, 1, "marisol", 1000)).ok).toBe(false);
    const c = (await w.load())!;
    c.rules.shortShare.allowed = false;
    await w.store.put("circle", c);
    expect((await proposeSplit(w.ctx, 1, "marisol", 6000)).ok).toBe(false);
  });

  it("a proposal changes no invoice until the member taps yes; a no keeps the old invoice", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const p = await proposeSplit(w.ctx, 1, "marisol", 6000);
    expect(w.sb.invoices.size).toBe(6);
    await consentSplit(w.ctx, (p as any).split.id, "marisol", "no");
    expect(w.sb.invoices.size).toBe(6);
    const s = (await getShare(w.ctx, 1, "marisol"))!;
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].status).toBe("SENT");
  });

  it("a paid share cannot be split", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const inv = (await getShare(w.ctx, 1, "marisol"))!.parts[0].invoiceId!;
    w.sb.payInvoice(inv);
    expect((await proposeSplit(w.ctx, 1, "marisol", 6000)).ok).toBe(false);
  });
});
