import { describe, expect, it } from "vitest";
import { startCircle, loadCircle } from "../../src/circle/shares";
import { consentSwap, findSwapPartners, proposeSwap, swapReason } from "../../src/circle/swap";
import { listMessages } from "../../src/circle/messages";
import { stateFor } from "../../src/circle/state";
import { keys, type Circle, type Swap } from "../../src/circle/model";
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

  it("1. Valid swap: the stored and projected why has the right months, needsKept includes Keisha's February need, consenters are the two members", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "theo");
    expect(r.ok).toBe(true);
    const swapId = (r as any).swap.id as string;
    const stored = await w.store.get<Swap>(keys.swap(swapId));
    expect(stored?.why).toBeDefined();
    expect(stored?.why).toMatchObject({
      fromMonth: "2027-05",
      toMonth: "2027-03",
      fromNow: "2027-03",
      toNow: "2027-05",
      consenters: ["sam", "theo"],
    });
    expect(stored?.why?.conflict).toBeUndefined();
    expect(stored?.why?.needsKept).toContainEqual({
      memberId: "keisha",
      name: "Keisha",
      text: "Keisha needs February 2027",
    });

    const c = await loadCircle(w.ctx);
    const orgState = await stateFor(w.ctx, c, { role: "organiser" }, {});
    const projected = (orgState.swaps as any[]).find((s) => s.id === swapId);
    expect(projected?.why).toEqual(stored?.why);
  });

  it("2. Conflicting February need: proposing a swap that would move Keisha off February is refused with that swap breaks a stated need: Keisha needs February 2027, and nothing is stored", async () => {
    const w = await world();
    const beforeSwaps = await w.store.list<Swap>({ prefix: "swap:" });
    const r = await proposeSwap(w.ctx, "sam", "keisha");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("that swap breaks a stated need: Keisha needs February 2027");
    const afterSwaps = await w.store.list<Swap>({ prefix: "swap:" });
    expect(afterSwaps.size).toBe(beforeSwaps.size);
  });

  it("3. One consent: after only one yes, circle.rotation is unchanged and projected swap shows consents with one yes", async () => {
    const w = await world();
    const before = await loadCircle(w.ctx);
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    const consentRes = await consentSwap(w.ctx, id, "sam", "yes");
    expect(consentRes.ok).toBe(true);
    expect(consentRes.applied).toBe(false);
    const after = await loadCircle(w.ctx);
    expect(after.rotation).toEqual(before.rotation);
    const orgState = await stateFor(w.ctx, after, { role: "organiser" }, {});
    const projected = (orgState.swaps as any[]).find((s) => s.id === id);
    expect(projected.consents).toEqual({ sam: "yes" });
  });

  it("4. Two consents: the turns move", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    await consentSwap(w.ctx, id, "theo", "yes");
    await consentSwap(w.ctx, id, "sam", "yes");
    const c = await loadCircle(w.ctx);
    expect(roundOf(c, "sam")).toBe(4);
    expect(roundOf(c, "theo")).toBe(6);
    const stored = await w.store.get<Swap>(keys.swap(id));
    expect(stored?.status).toBe("applied");
  });

  it("5. Stale proposal: change the rotation between the two yeses; the second yes leaves the rotation as it was, swap status is stale, and a change line is added", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    await consentSwap(w.ctx, id, "sam", "yes");

    const c = await loadCircle(w.ctx);
    const theoSlot = c.rotation.find((s) => s.memberId === "theo")!;
    const danaSlot = c.rotation.find((s) => s.memberId === "dana")!;
    theoSlot.memberId = "dana";
    danaSlot.memberId = "theo";
    await w.store.put("circle", c);

    const second = await consentSwap(w.ctx, id, "theo", "yes");
    expect(second.ok).toBe(false);
    expect(second.error).toBe("the schedule changed since the ask; nothing moved");

    const cAfter = await loadCircle(w.ctx);
    expect(cAfter.rotation).toEqual(c.rotation);

    const stored = await w.store.get<Swap>(keys.swap(id));
    expect(stored?.status).toBe("stale");

    const changes = await w.store.list<{ at: string; text: string }>({ prefix: "change:" });
    const changeLines = [...changes.values()].map((x) => x.text);
    expect(changeLines.some((t) => t.includes("Sam and Theo's swap did not move: the schedule changed before both said yes"))).toBe(true);
  });

  it("6. Privacy: a third member's state does not list the swap; the two members and the organiser get why", async () => {
    const w = await world();
    const r = await proposeSwap(w.ctx, "sam", "theo");
    const id = (r as any).swap.id as string;
    const c = await loadCircle(w.ctx);

    const outsiderState = await stateFor(w.ctx, c, { role: "member", memberId: "keisha" }, {});
    const outsiderSwap = (outsiderState.swaps as any[]).find((s) => s.id === id);
    expect(outsiderSwap).toBeUndefined();

    const samState = await stateFor(w.ctx, c, { role: "member", memberId: "sam" }, {});
    const samSwap = (samState.swaps as any[]).find((s) => s.id === id);
    expect(samSwap).toBeDefined();
    expect(samSwap.why).toBeDefined();
    expect(samSwap.why.needsKept).toBeDefined();

    const theoState = await stateFor(w.ctx, c, { role: "member", memberId: "theo" }, {});
    const theoSwap = (theoState.swaps as any[]).find((s) => s.id === id);
    expect(theoSwap).toBeDefined();
    expect(theoSwap.why).toBeDefined();

    const orgState = await stateFor(w.ctx, c, { role: "organiser" }, {});
    const orgSwap = (orgState.swaps as any[]).find((s) => s.id === id);
    expect(orgSwap).toBeDefined();
    expect(orgSwap.why).toBeDefined();
  });

  it("7. Pure unit test of swapReason with a need of each kind", () => {
    const c: Circle = {
      id: "c-test",
      name: "Test",
      currency: "USD",
      shareCents: 10000,
      startMonth: "2027-01",
      payDay: 15,
      status: "active",
      demo: false,
      createdAt: "2027-01-01T00:00:00.000Z",
      version: 1,
      organiserToken: "org",
      rules: { privacy: true, shortShare: { allowed: false, minNowCents: 0, laterDays: 0 }, missed: { graceDays: 0, action: "move_to_end" }, confirmers: [] },
      members: [
        { id: "m1", name: "Keisha", lang: "en", slot: 1, token: "t1" },
        { id: "m2", name: "Dana", lang: "en", slot: 2, token: "t2" },
        { id: "m3", name: "Sam", lang: "en", slot: 3, token: "t3" },
        { id: "m4", name: "Ana", lang: "en", slot: 4, token: "t4" },
      ],
      rotation: [
        { round: 1, memberId: "m1", month: "2027-01", date: "2027-01-15" },
        { round: 2, memberId: "m2", month: "2027-02", date: "2027-02-15" },
        { round: 3, memberId: "m3", month: "2027-03", date: "2027-03-15" },
        { round: 4, memberId: "m4", month: "2027-04", date: "2027-04-15" },
      ],
      needs: [
        { memberId: "m1", kind: "want", month: "2027-02" },
        { memberId: "m2", kind: "avoid", month: "2027-05" },
        { memberId: "m3", kind: "on_or_before", month: "2027-03" },
        { memberId: "m4", kind: "on_or_after", month: "2027-04" },
      ],
    };

    const reason = swapReason(c, "m1", "m2", 1, 2);
    expect(reason.fromMonth).toBe("2027-01");
    expect(reason.toMonth).toBe("2027-02");
    expect(reason.fromNow).toBe("2027-02");
    expect(reason.toNow).toBe("2027-01");
    expect(reason.consenters).toEqual(["m1", "m2"]);
    expect(reason.conflict).toBeUndefined();
    expect(reason.needsKept).toEqual([
      { memberId: "m1", name: "Keisha", text: "Keisha needs February 2027" },
      { memberId: "m2", name: "Dana", text: "Dana cannot take May 2027" },
      { memberId: "m3", name: "Sam", text: "Sam needs a turn by March 2027" },
      { memberId: "m4", name: "Ana", text: "Ana needs a turn in April 2027 or later" },
    ]);

    const wantConflict = swapReason(c, "m1", "m3", 1, 3);
    expect(wantConflict.conflict).toEqual({
      memberId: "m1",
      name: "Keisha",
      text: "Keisha needs February 2027",
    });

    const cAvoid: Circle = {
      ...c,
      needs: [{ memberId: "m2", kind: "avoid", month: "2027-01" }],
    };
    const avoidConflict = swapReason(cAvoid, "m1", "m2", 1, 2);
    expect(avoidConflict.conflict).toEqual({
      memberId: "m2",
      name: "Dana",
      text: "Dana cannot take January 2027",
    });

    const beforeConflict = swapReason(c, "m3", "m4", 3, 4);
    expect(beforeConflict.conflict).toEqual({
      memberId: "m3",
      name: "Sam",
      text: "Sam needs a turn by March 2027",
    });

    const afterConflict = swapReason(c, "m4", "m2", 4, 2);
    expect(afterConflict.conflict).toEqual({
      memberId: "m4",
      name: "Ana",
      text: "Ana needs a turn in April 2027 or later",
    });
  });
});
