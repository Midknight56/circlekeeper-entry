import { describe, expect, it } from "vitest";
import { startCircle, loadCircle } from "../../src/circle/shares";
import { consentSwap, findSwapPartners, proposeSwap } from "../../src/circle/swap";
import { listMessages } from "../../src/circle/messages";
import { stateFor } from "../../src/circle/state";
import { world } from "../helpers/world";

// Rotation in the test world: marisol 1 (Dec), dana 2 (Jan), keisha 3 (Feb, her stated need), theo 4 (Mar),
// amelie 5 (Apr), sam 6 (May).
const roundOf = (c: { rotation: { memberId: string; round: number }[] }, id: string) =>
  c.rotation.find((s) => s.memberId === id)!.round;

describe("turn swaps", () => {
  it("finds the holder of the wanted round and says whether a swap keeps every stated need", async () => {
    const w = await world();
    const p = await findSwapPartners(w.ctx, "sam", 4);
    expect(p.ok).toBe(true);
    expect(p.partners[0]).toMatchObject({ memberId: "theo", round: 4, fits: true });
    // keisha needs February: nobody may take round 3 from her
    const k = await findSwapPartners(w.ctx, "sam", 3);
    expect(k.partners.find((x) => x.memberId === "keisha")!.fits).toBe(false);
  });

  it("a proposal moves nothing and sends each member a private ask", async () => {
    const w = await world();
    const before = await loadCircle(w.ctx);
    const r = await proposeSwap(w.ctx, "sam", "theo", "rent went up");
    expect(r.ok).toBe(true);
    const after = await loadCircle(w.ctx);
    expect(after.rotation).toEqual(before.rotation);
    const theoMsgs = await listMessages(w.ctx, { memberId: "theo" });
    expect(theoMsgs.some((m) => m.kind === "ask" && m.to === "member:theo")).toBe(true);
    const keishaMsgs = await listMessages(w.ctx, { memberId: "keisha" });
    expect(keishaMsgs.some((m) => m.kind === "ask")).toBe(false);
  });

  it("the rotation changes only after both taps", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    await consentSwap(w.ctx, id, "theo", "yes");
    let c = await loadCircle(w.ctx);
    expect(roundOf(c, "sam")).toBe(6);
    await consentSwap(w.ctx, id, "sam", "yes");
    c = await loadCircle(w.ctx);
    expect(roundOf(c, "sam")).toBe(4);
    expect(roundOf(c, "theo")).toBe(6);
    const changes = await w.store.list<any>({ prefix: "change:" });
    // The time is shown by each page in the viewer's own zone (from "at"), never baked into the text in UTC.
    expect([...changes.values()][0].text).toBe("Sam and Theo swapped turns, both agreed");
  });

  it("a No cancels the swap and nothing moves", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    await consentSwap(w.ctx, id, "sam", "yes");
    const no = await consentSwap(w.ctx, id, "theo", "no");
    expect(no.ok).toBe(true);
    const c = await loadCircle(w.ctx);
    expect(roundOf(c, "sam")).toBe(6);
    const late = await consentSwap(w.ctx, id, "theo", "yes");
    expect(late.ok).toBe(false);
  });

  it("a decline keeps the rotation, every pot recipient, and every invoice unchanged, then asks the next best partner", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const beforeCircle = await loadCircle(w.ctx);
    const beforePots = await w.store.list<any>({ prefix: "pot:" });
    const beforeInvoices = [...w.sb.invoices.values()];
    const initial = await proposeSwap(w.ctx, "sam", "theo");
    const id = (initial as any).swap.id as string;
    const candidates = await findSwapPartners(w.ctx, "sam", 4);
    const next = candidates.partners.find((p) => p.fits && p.memberId !== "theo")!;

    await consentSwap(w.ctx, id, "theo", "no");

    expect((await loadCircle(w.ctx)).rotation).toEqual(beforeCircle.rotation);
    expect(await w.store.list<any>({ prefix: "pot:" })).toEqual(beforePots);
    expect([...w.sb.invoices.values()]).toEqual(beforeInvoices);
    const swaps = [...(await w.store.list<any>({ prefix: "swap:" })).values()];
    expect(swaps.find((s) => s.status === "asked")).toMatchObject({ from: "sam", to: next.memberId });
    const samMessages = await listMessages(w.ctx, { memberId: "sam" });
    expect(samMessages.some((m) => m.text.includes("Theo said no") && m.text.includes(next.name))).toBe(true);
    expect((await listMessages(w.ctx, { memberId: "keisha" })).some((m) => /Theo said no|said no/i.test(m.text))).toBe(false);
  });

  it("after the last eligible partner declines, says plainly that no one else can swap", async () => {
    const w = await world();
    const first = await proposeSwap(w.ctx, "sam", "theo");
    await consentSwap(w.ctx, (first as any).swap.id, "theo", "no");
    const pending = [...(await w.store.list<any>({ prefix: "swap:" })).values()].find((s) => s.status === "asked")!;
    expect(pending.to).not.toBe("theo");
    const eligible = (await findSwapPartners(w.ctx, "sam", 4)).partners.filter((p) => p.fits);
    for (const p of eligible.filter((p) => p.memberId !== "theo" && p.memberId !== pending.to)) {
      await w.store.put(`swap:old-${p.memberId}`, {
        id: `old-${p.memberId}`, from: "sam", to: p.memberId, fromRound: 6, toRound: 4, requestRound: 4,
        consents: { [p.memberId]: "no" }, status: "declined", createdAt: "2026-12-01T00:00:00.000Z",
      });
    }
    await consentSwap(w.ctx, pending.id, pending.to, "no");
    const samMessages = await listMessages(w.ctx, { memberId: "sam" });
    expect(samMessages.some((m) => /no one else can swap/i.test(m.text)), JSON.stringify(samMessages.map((m) => m.text))).toBe(true);
  });

  it("keeps a decline private from a member outside the swap", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "theo");
    await consentSwap(w.ctx, (r as any).swap.id, "theo", "no");
    const c = await loadCircle(w.ctx);
    const outsider = await stateFor(w.ctx, c, { role: "member", memberId: "keisha" }, {});
    expect((outsider.swaps as any[]).some((s) => s.status === "declined")).toBe(false);
    expect((outsider.messages as any[]).some((m) => /Theo said no|said no/i.test(m.text))).toBe(false);
    expect(outsider).not.toHaveProperty("log");
    const organiser = await stateFor(w.ctx, c, { role: "organiser" }, {});
    expect((organiser.log as any[]).filter((entry) => entry.note?.includes("declined"))).toHaveLength(1);
  });

  it("tells the asker about a decline in Spanish and French", async () => {
    const w = await world();
    const spanish = await proposeSwap(w.ctx, "marisol", "theo");
    await consentSwap(w.ctx, (spanish as any).swap.id, "theo", "no");
    const spanishMessage = (await listMessages(w.ctx, { memberId: "marisol" })).find((m) => m.text.includes("dijo que no"));
    expect(spanishMessage?.text).toContain("Nada ha cambiado");

    const w2 = await world();
    const french = await proposeSwap(w2.ctx, "amelie", "theo");
    await consentSwap(w2.ctx, (french as any).swap.id, "theo", "no");
    const frenchMessage = (await listMessages(w2.ctx, { memberId: "amelie" })).find((m) => m.text.includes("a dit non"));
    expect(frenchMessage?.text).toContain("Rien n'a changé");
  });

  it("only the two members of the swap can tap", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    const res = await consentSwap(w.ctx, id, "keisha", "yes");
    expect(res.ok).toBe(false);
  });

  it("a swap that would break a stated need is refused", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "keisha");
    expect(r.ok).toBe(false);
  });

  it("a round whose pot already left cannot be swapped", async () => {
    const w = await world();
    await w.store.put("pot:01", { round: 1, recipientId: "marisol", cents: 60000, status: "paid", confirmations: [], senderBatchId: "x", requestId: "y" });
    const r = await proposeSwap(w.ctx, "sam", "marisol");
    expect(r.ok).toBe(false);
  });
});
