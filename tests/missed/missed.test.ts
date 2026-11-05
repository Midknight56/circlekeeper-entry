import { describe, expect, it } from "vitest";
import { startCircle, loadCircle } from "../../src/circle/shares";
import { draftCircle } from "../../src/circle/create";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import { consentMissed, findMissed, proposeMissed } from "../../src/circle/missed";
import { stateFor } from "../../src/circle/state";
import { world } from "../helpers/world";

describe("missed share path", () => {
  it("gives new circles the default grace and action", () => {
    expect(draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle?.rules.missed)
      .toEqual({ graceDays: 3, action: "move_to_end" });
  });
  async function lateNonConfirmer(w: Awaited<ReturnType<typeof world>>) {
    const c = await w.load();
    c.needs = [];
    await w.store.put("circle", c);
  }
  it("does not propose a share until its due date plus grace has passed", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.setNow("2026-12-13T12:00:00Z");
    expect(await findMissed(w.ctx)).toEqual([]);
  });

  it("asks both confirmers and tells each member in their language without sharing amounts", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.setNow("2026-12-20T12:00:00Z");
    const found = await findMissed(w.ctx);
    expect(found).toContainEqual(expect.objectContaining({ round: 1, memberId: "theo" }));
    const result = await proposeMissed(w.ctx, 1, "theo");
    expect(result.ok).toBe(true);
    const messages = [...(await w.store.list<any>({ prefix: "msg:" })).values()];
    // Each member hears it once, in their own language, with the planned change in months.
    for (const id of ["marisol", "amelie", "sam", "keisha", "dana", "theo"]) {
      expect(messages.filter((m) => m.to === `member:${id}`).length).toBe(1);
    }
    expect(messages.find((m) => m.to === "member:marisol")?.text).toMatch(/El turno de Theo pasa de \w+ de 2027 a \w+ de 2027/);
    expect(messages.find((m) => m.to === "member:amelie")?.text).toMatch(/Le tour de Theo passe de \w+ 2027 à \w+ 2027/);
    expect(messages.find((m) => m.to === "member:sam")?.text).toMatch(/Theo's turn moves from \w+ 2027 to \w+ 2027/);
    for (const message of messages.filter((m) => m.to.startsWith("member:") && m.to !== "member:theo" && m.kind !== "ask")) {
      expect(message.text).not.toMatch(/past (?:its due date|due)|pasó su fecha|dépassé sa date|en retard/);
    }
    // Theo is a confirmer but is the late member: he gets the private line, Dana alone decides.
    expect(messages.find((m) => m.to === "member:dana")?.kind).toBe("ask");
    expect(messages.find((m) => m.to === "member:dana" && m.kind === "ask")?.text).toContain("past due");
    expect(messages.find((m) => m.to === "member:theo")?.text).toContain("PayPal invoice stays live");
    expect(messages.some((m) => m.to === "organiser")).toBe(true);
    const groupText = messages.filter((m) => m.to === "group").map((m) => m.text).join(" ");
    expect(groupText).not.toMatch(/\$\s*\d|100\.00/);
  });

  it("moves open turns only after two yes answers", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await lateNonConfirmer(w);
    await w.store.put("pot:04", { round: 4, recipientId: "theo", cents: 60000, status: "paid", confirmations: [], senderBatchId: "sent", requestId: "sent" });
    for (const [round, recipientId] of [[3, "keisha"], [5, "amelie"], [6, "sam"]] as const) {
      await w.store.put(`pot:${String(round).padStart(2, "0")}`, { round, recipientId, cents: 60000, status: "waiting", confirmations: [], senderBatchId: `b${round}`, requestId: `r${round}` });
    }
    w.setNow("2026-12-20T12:00:00Z");
    const result = await proposeMissed(w.ctx, 1, "keisha");
    const id = (result as any).missed.id;
    await consentMissed(w.ctx, id, "dana", "yes");
    expect((await loadCircle(w.ctx)).rotation.find((s) => s.memberId === "keisha")?.round).toBe(3);
    await consentMissed(w.ctx, id, "theo", "yes");
    const c = await loadCircle(w.ctx);
    expect(c.rotation.find((s) => s.memberId === "keisha")?.round).toBe(6);
    expect(c.rotation.find((s) => s.memberId === "sam")?.round).toBe(5);
    expect(c.rotation.find((s) => s.round === 4)?.memberId).toBe("theo");
    expect((await w.store.get<any>("pot:04")).recipientId).toBe("theo");
    expect((await w.store.get<any>("pot:03")).recipientId).toBe("amelie");
    expect((await w.store.get<any>("pot:05")).recipientId).toBe("sam");
    expect((await w.store.get<any>("pot:06")).recipientId).toBe("keisha");
  });

  it("declines on one no and rejects answers from anyone outside the confirmer pair", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await lateNonConfirmer(w);
    w.setNow("2026-12-20T12:00:00Z");
    const result = await proposeMissed(w.ctx, 1, "keisha");
    const id = (result as any).missed.id;
    expect((await consentMissed(w.ctx, id, "marisol", "yes")).ok).toBe(false);
    expect((await consentMissed(w.ctx, id, "keisha", "yes")).ok).toBe(false);
    const before = (await loadCircle(w.ctx)).rotation;
    await consentMissed(w.ctx, id, "dana", "no");
    expect((await loadCircle(w.ctx)).rotation).toEqual(before);
  });

  it("closes the ask if the share is paid before both votes", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await lateNonConfirmer(w);
    w.setNow("2026-12-20T12:00:00Z");
    const result = await proposeMissed(w.ctx, 1, "keisha");
    const id = (result as any).missed.id;
    const share = await w.store.get<any>("share:01:keisha");
    w.sb.payInvoice(share.parts[0].invoiceId);
    await consentMissed(w.ctx, id, "dana", "yes");
    await consentMissed(w.ctx, id, "theo", "yes");
    expect(await w.store.get<any>(`missed:${id}`)).toMatchObject({ status: "declined", reason: "paid before the vote" });
  });

  it("falls back to pot waits when moving would break a stated need", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.setNow("2026-12-20T12:00:00Z");
    const result = await proposeMissed(w.ctx, 1, "keisha");
    expect((result as any).missed.action).toBe("pot_waits");
    expect((result as any).missed.reason).toBeTruthy();
  });

  it("does not make a model call and sends no PayPal write other than a reminder", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const before = w.sb.invoices.size;
    const beforeReminders = w.sb.calls("POST /v2/invoicing/invoices/").filter((call: any) => call.path.endsWith("/remind")).length;
    w.setNow("2026-12-20T12:00:00Z");
    await proposeMissed(w.ctx, 1, "theo");
    expect(w.sb.invoices.size).toBe(before);
    expect(w.sb.payouts.size).toBe(0);
    expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((call: any) => call.path.endsWith("/remind"))).toHaveLength(beforeReminders + 1);
  });

  it("shows missed records to the organiser and hides other members' private details", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.setNow("2026-12-20T12:00:00Z");
    await proposeMissed(w.ctx, 1, "theo");
    const c = await loadCircle(w.ctx);
    expect((await stateFor(w.ctx, c, { role: "organiser" }, {})).missed).toHaveLength(1);
    expect((await stateFor(w.ctx, c, { role: "member", memberId: "sam" }, {})).missed).toHaveLength(0);
  });
});
