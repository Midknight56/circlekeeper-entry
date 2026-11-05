import { expect, it } from "vitest";
import { applyDropRule } from "../../src/ai/drop";
import { roundView } from "../../src/ai/tools";
import { startCircle, getShare } from "../../src/circle/shares";
import { proposeSplit, consentSplit } from "../../src/circle/split";
import { world } from "../helpers/world";

async function paidPart() {
  const w = await world();
  await startCircle(w.ctx);
  const split = await proposeSplit(w.ctx, 1, "marisol", 6000);
  await consentSplit(w.ctx, split.split!.id, "marisol", "yes");
  const live = (await getShare(w.ctx, 1, "marisol"))!.parts.filter((p) => p.status !== "CANCELLED");
  w.sb.payInvoice(live[0].invoiceId!);
  w.setNow("2026-12-01T15:02:00Z");
  return { w, data: await roundView(w.ctx, 1) };
}
const check = (text: string, data: unknown, speakerName?: string) => applyDropRule(
  [{ to: "organiser", text, refs: ["r"] }], { r: data }, ["Marisol"], { speakerName },
);

it("rejects borrowing a paid status from a different invoice part", async () => {
  const { data } = await paidPart();
  expect(check("Marisol has paid $40.", data).kept).toEqual([]);
  expect(check("Marisol has paid $60.", data).kept).toHaveLength(1);
  expect(check("You have paid $40.", data, "Marisol").kept).toEqual([]);
});

it("keeps the unpaid part even when another part is paid", async () => {
  const { data } = await paidPart();
  expect(check("Marisol has not paid $40.", data).kept).toHaveLength(1);
  expect(check("Marisol has not paid $60.", data).kept).toEqual([]);
});

it("checks round and invoice part together with amount and status", async () => {
  const { data } = await paidPart();
  expect(check("Marisol paid $60 for part 2 in round 1.", data).kept).toEqual([]);
  expect(check("Marisol paid $60 for part 1 in round 2.", data).kept).toEqual([]);
  expect(check("Marisol paid $60 for part 1 in round 1.", data).kept).toHaveLength(1);
  expect(check("Marisol paid $1 for part 1 in round 1.", data).kept).toEqual([]);
});

it("exposes explicit paid totals and backs an aggregate with that total alone", async () => {
  const { w, data } = await paidPart();
  const member = (data.shares as any[]).find((s) => s.memberId === "marisol");
  expect(member.paidCents).toBe(6000);
  expect(member.parts[0]).toMatchObject({ memberId: "marisol", name: "Marisol", round: 1, part: 1, direction: "paid", cents: 6000, status: "PAID" });
  expect(check("Marisol has paid $100 in total.", data).kept).toEqual([]);
  const live = (await getShare(w.ctx, 1, "marisol"))!.parts.filter((p) => p.status !== "CANCELLED");
  w.sb.payInvoice(live[1].invoiceId!);
  w.setNow("2026-12-01T15:04:00Z");
  const paid = await roundView(w.ctx, 1);
  expect(check("Marisol has paid $100 in total.", paid).kept).toHaveLength(1);
  const privateView = await roundView(w.ctx, 1, false, { role: "member", memberId: "sam" });
  expect((privateView.shares as any[]).find((s) => s.memberId === "marisol").paidCents).toBeUndefined();
});
