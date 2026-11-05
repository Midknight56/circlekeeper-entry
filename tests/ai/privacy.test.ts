import { describe, expect, it } from "vitest";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { addMsg, listMessages } from "../../src/circle/messages";
import { startCircle } from "../../src/circle/shares";
import { stateFor } from "../../src/circle/state";
import { world } from "../helpers/world";
// @ts-ignore plain JavaScript shared with the pages
import { layout } from "../../public/js/schedule-view-basic.js";
// @ts-ignore plain JavaScript shared with the pages
import { toProjectData } from "../../public/js/bryntum-data.js";
import { monthGrid } from "../../public/js/member-calendar.js";
import { toBryntumEvents } from "../../public/js/member-calendar-bryntum.js";

async function splitWorld(privacy = true) {
  const w = await world();
  w.circle.rules.privacy = privacy;
  await w.store.put("circle", w.circle);
  await startCircle(w.ctx);
  const share = (await w.store.get<any>("share:01:marisol"))!;
  share.parts = [6000, 4000].map((cents, i) => ({ ...share.parts[0], number: `part-${i}`, cents, checkedAt: w.ctx.now().toISOString() }));
  await w.store.put("share:01:marisol", share);
  await w.store.put("split:private", { id: "private", round: 1, memberId: "marisol", nowCents: 6000, laterCents: 4000, dueDate: "2026-12-15", status: "applied" });
  return w;
}

const reply = (to: string, text = "Marisol has $40 due.", refs = ["call_1"]) => new RecordedModel([
  JSON.stringify({ action: null, say: [{ to, text, refs }] }),
]);

describe("privacy on every path", () => {
  it("drops a backed group amount and records the privacy reason", async () => {
    const w = await splitWorld();
    const out = await runTurn(w.ctx, reply("group"), { role: "organiser" }, "status?");
    expect(out.said.some((m) => m.to === "group")).toBe(false);
    expect((await listMessages(w.ctx, { memberId: "sam" })).some((m) => m.to === "group")).toBe(false);
    expect(out.dropped).toBe(1);
    const log = [...(await w.store.list<any>({ prefix: "log:" })).values()];
    expect(log.some((l) => l.note === "dropped: privacy, a member's amount in a group message")).toBe(true);
  });

  it("allows the member's own private amount and the organiser's reply", async () => {
    const w = await splitWorld();
    for (const [to, speaker] of [["member:marisol", { role: "member", memberId: "marisol" }], ["organiser", { role: "organiser" }]] as const) {
      const out = await runTurn(w.ctx, reply(to), speaker, "status?");
      expect(out.said.map((m) => m.text)).toEqual(["Marisol has $40 due."]);
    }
  });

  it("drops another member's due amount when only the planned share is cited", async () => {
    const w = await splitWorld();
    const out = await runTurn(w.ctx, reply("member:sam", "Marisol has $100 due.", ["call_0"]), { role: "member", memberId: "sam" }, "status?");
    expect(out.said.some((m) => m.text.includes("Marisol"))).toBe(false);
    const log = [...(await w.store.list<any>({ prefix: "log:" })).values()];
    expect(out.dropped).toBe(1);
    expect(log.some((l) => l.kind === "drop" && l.note?.includes("not backed by a tool result"))).toBe(true);
  });

  it.each(["Marisol owes a share.", "Marisol has a share due.", "Marisol is unpaid.", "Marisol debe su parte.", "Marisol doit sa part."])("protects an owed status without an amount: %s", async (text) => {
    const w = await splitWorld();
    const out = await runTurn(w.ctx, reply("group", text), { role: "organiser" }, "status?");
    expect(out.said.some((m) => m.to === "group")).toBe(false);
  });

  it("keeps safe sentences in the same reply", async () => {
    const w = await splitWorld();
    const out = await runTurn(w.ctx, reply("group", "Marisol has $40 due. Thanks for keeping the circle going."), { role: "organiser" }, "status?");
    expect(out.said.map((m) => m.text)).toEqual(["Thanks for keeping the circle going."]);
  });

  it("removes amounts from server group notices only with privacy on", async () => {
    for (const privacy of [true, false]) {
      const w = await splitWorld(privacy);
      for (const text of ["Marisol will pay $60 now and $40 later.", "Marisol pagará 60,00 $ y 40,00 $.", "Marisol paiera 60,00 $ puis 40,00 $."]) {
        const msg = await addMsg(w.ctx, { to: "group", from: "treasurer", kind: "notice", text });
        expect(/60|40/.test(msg.text)).toBe(!privacy);
        expect(msg.text).toContain("Marisol");
      }
    }
  });

  it("hides other members' parts and receipt amounts throughout state", async () => {
    const w = await splitWorld();
    const pot = (await w.store.get<any>("pot:01"))!;
    await w.store.put("pot:01", { ...pot, status: "paid" });
    for (const viewer of [{ role: "member", memberId: "sam" }, { role: "member", memberId: "marisol" }, { role: "organiser" }] as const) {
      const state: any = await stateFor(w.ctx, await w.load(), viewer, {});
      const json = JSON.stringify(state);
      const hidden = viewer.role === "member" && viewer.memberId === "sam";
      expect(/\b6000\b/.test(json)).toBe(!hidden);
      expect(/\b4000\b/.test(json)).toBe(!hidden);
      const share = state.rounds[0].shares.find((s: any) => s.memberId === "marisol");
      if (hidden) {
        expect(share).toEqual({ memberId: "marisol", state: "sent", partCount: 2 });
        expect(state.receipts[0].lines.filter((l: any) => l.memberId === "marisol").every((l: any) => l.cents === undefined)).toBe(true);
        expect(state.receipts[0].redacted).toBe(true);
        expect(state.receipts[0].hash).toBeUndefined();
      }
    }
  });

  it("renders withheld parts as status and keeps the member's own calendars usable", async () => {
    const w = await splitWorld();
    const state: any = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "sam" }, {});
    const basic = layout(state).rows.find((r: any) => r.memberId === "marisol");
    expect(basic!.chips.filter((c: any) => c.kind === "share").map((c: any) => c.label)).toEqual(["Not paid yet", "Not paid yet"]);
    const pot = layout(state).rows.flatMap((r: any) => r.chips).find((c: any) => c.kind === "pot" && c.round === 1);
    expect(pot.heldBy).toContain("marisol");
    expect(pot.held).toBe(7);
    const events = toProjectData(state).events.filter((e: any) => e.memberId === "marisol" && e.kind === "share");
    expect(events.map((e: any) => e.name)).toEqual(["Not paid yet", "Not paid yet"]);
    const share = state.rounds[0].shares.find((s: any) => s.memberId === "sam");
    const rows = share.parts.map((p: any) => ({ id: p.number, memberId: "sam", kind: "share", date: p.dueDate, amount: `$${p.cents / 100}`, label: "Share due", status: p.status }));
    expect(monthGrid(rows, "2026-12", "en").weeks.length).toBeGreaterThan(0);
    expect(toBryntumEvents(rows, "sam", "en", { potDay: "Your pot", paid: "Paid", shareDue: "Share due" })).toHaveLength(rows.length);
  });

  it("allows group amounts and other members' full parts when privacy is off", async () => {
    const w = await splitWorld(false);
    const out = await runTurn(w.ctx, reply("group"), { role: "organiser" }, "status?");
    expect(out.said.map((m) => m.text)).toEqual(["Marisol has $40 due."]);
    const state = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "sam" }, {});
    expect(JSON.stringify(state)).toContain("6000");
    expect(JSON.stringify(state)).toContain("4000");
  });
});
