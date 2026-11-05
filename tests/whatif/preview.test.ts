import { describe, expect, it } from "vitest";
import { loadCircle, startCircle } from "../../src/circle/shares";
import { previewWhatIf } from "../../src/circle/whatif";
import { world } from "../helpers/world";

async function settleBeforeMarch(w: Awaited<ReturnType<typeof world>>) {
  for (const round of [1, 2, 3]) await w.store.put(`pot:${String(round).padStart(2, "0")}`, {
    round, recipientId: "settled", cents: 60000, status: "paid", confirmations: [], senderBatchId: `b${round}`, requestId: `r${round}`,
  });
}

describe("what if previews", () => {
  it("quotes the same seven share amount stored for Rae's new round", async () => {
    const w = await world();
    const result = await previewWhatIf(w.ctx, { kind: "join", name: "Rae" });
    const added = result.rotation.at(-1)!;
    expect(result.potCentsByRound?.[added.round]).toBe(70000);
    expect(result.lines.en.join(" ")).toContain("The new pot is $700.00 from 7 shares.");
    expect(Object.keys(result.potCentsByRound!)).toEqual([String(added.round)]);
  });

  it("reduces every waiting pot from March when Sam leaves and reports the removed turn", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await settleBeforeMarch(w);
    const before = await loadCircle(w.ctx);
    const result = await previewWhatIf(w.ctx, { kind: "leave", memberId: "sam", month: "2027-03" });
    expect(result.potCentsByRound).toEqual({ 4: 50000, 5: 50000 });
    expect(result.rotation).toHaveLength(before.rotation.length - 1);
    expect(result.rotation.find((slot) => slot.round === 4)?.memberId).toBe(before.rotation.find((slot) => slot.round === 4)?.memberId);
    expect(result.lines.en.join(" ")).toContain("Sam's turn in May 2027 is removed.");
  });

  it("leaves settled and earlier rounds alone and re-solves the open schedule", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await settleBeforeMarch(w);
    const before = await loadCircle(w.ctx);
    const result = await previewWhatIf(w.ctx, { kind: "leave", memberId: "theo", month: "2027-03" });
    expect(result.rotation.filter((slot: any) => slot.round <= 3)).toEqual(before.rotation.filter((slot) => slot.round <= 3));
    expect(result.rotation).toHaveLength(before.rotation.length - 1);
    expect(result.rotation.some((slot: any) => slot.memberId === "theo")).toBe(false);
    expect(result.lines.en.join(" ")).toContain("March");
    const amelie = (await w.load()).members.find((member) => member.id === "amelie")!.name;
    expect(result.lines.en.join(" ")).toContain(`${amelie} moves from April 2027 to March 2027`);
    expect(result.lines.en.join(" ")).toContain("Sam moves from May 2027 to April 2027");
    expect(result.lines.en.join(" ")).toContain("Pot: $500.00");
  });

  it("reports the paid in amount and says when a departing member is a confirmer", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await settleBeforeMarch(w);
    const share = await w.store.get<any>("share:01:theo");
    share.parts[0].status = "PAID";
    share.parts[0].cents = 7500;
    await w.store.put("share:01:theo", share);
    await w.store.put("share:02:theo", { round: 2, memberId: "theo", reminders: [], parts: [{ cents: 2500, dueDate: "2027-01-10", status: "PAID", requestId: "paid", number: "paid" }] });
    await w.store.put("pot:04", { round: 4, recipientId: "theo", cents: 12500, status: "paid", confirmations: [], senderBatchId: "b4", requestId: "r4" });
    const result = await previewWhatIf(w.ctx, { kind: "leave", memberId: "theo", month: "2027-03" });
    expect(result.money.en.join(" ")).toContain("$100.00");
    expect(result.money.en.join(" ")).toContain("has paid in $100.00 and received $125.00. The circle needs to agree how to settle this.");
    expect(result.money.en.join(" ")).not.toContain("owe it back");
    expect(result.money.es.join(" ")).toContain("ha pagado 100,00 US$ y ha recibido 125,00 US$. El círculo tiene que acordar cómo resolverlo.");
    expect(result.money.fr.join(" ")).toContain("a versé 100,00 $US et a reçu 125,00 $US. Le cercle doit décider comment régler cela.");
    expect(result.lines.en.join(" ")).toContain("new confirmer");
  });

  it("does not count a pot that has not been paid", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await w.store.put("pot:04", { round: 4, recipientId: "theo", cents: 12500, status: "paying", confirmations: [], senderBatchId: "b4", requestId: "r4" });
    const result = await previewWhatIf(w.ctx, { kind: "leave", memberId: "theo", month: "2027-03" });
    expect(result.money.en.join(" ")).toContain("received $0.00");
  });

  it("adds one round for a new member", async () => {
    const w = await world();
    const result = await previewWhatIf(w.ctx, { kind: "join", name: "Rae" });
    expect(result.rotation).toHaveLength((await loadCircle(w.ctx)).rotation.length + 1);
    expect(result.members?.at(-1)).toMatchObject({ name: "Rae" });
  });

  it("reports a need that cannot fit in the open schedule", async () => {
    const w = await world();
    const result = await previewWhatIf(w.ctx, { kind: "need", memberId: "sam", needKind: "want", month: "2027-02" });
    expect(result.broken.length).toBeGreaterThan(0);
  });

  it("stores only the preview and leaves the stored circle byte for byte the same", async () => {
    const w = await world();
    const before = JSON.stringify(await w.store.get("circle"));
    const paypalCalls = w.sb.sent.length;
    const keysBefore = [...w.store.data.keys()].sort();
    await previewWhatIf(w.ctx, { kind: "join", name: "Rae" });
    expect(JSON.stringify(await w.store.get("circle"))).toBe(before);
    expect(w.sb.sent).toHaveLength(paypalCalls);
    expect(await w.store.get("whatif:current")).toBeTruthy();
    expect([...w.store.data.keys()].filter((key) => !keysBefore.includes(key))).toEqual(["whatif:current"]);
  });
});
