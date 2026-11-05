import { expect, it } from "vitest";
import { applyDropRule } from "../../src/ai/drop";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { circleView, roundView } from "../../src/ai/tools";
import { keys, type Pot } from "../../src/circle/model";
import { getShare, refreshShare, startCircle } from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { world } from "../helpers/world";

async function paidSam() {
  const w = await world();
  await startCircle(w.ctx);
  const share = (await getShare(w.ctx, 1, "sam"))!;
  w.sb.payInvoice(share.parts[0].invoiceId!);
  await refreshShare(w.ctx, share);
  return w;
}

for (const text of ["The pot has $1 paid.", "Alice has paid $100.", "Alice and Sam have paid $100.", "Sam paid $100 and Alice paid $100.", "The pot has $600 paid.", "Someone has paid $100.", "A member has paid $100.", "$600 has been collected.", "The pot paid out $100."]) {
  it(`uses a safe fallback for an unsupported financial relationship: ${text}`, async () => {
    const w = await paidSam();
    const out = await runTurn(w.ctx, new RecordedModel([JSON.stringify({ say: [{ to: "organiser", text, refs: ["call_1"] }] })]), { role: "organiser" }, "What has been paid?");
    expect(out.dropped).toBe(1);
    expect(out.said.map((s) => s.text)).not.toContain(text);
  });
}

it("exposes typed member, collected and payout facts with separate money fields", async () => {
  const w = await paidSam();
  const data = await roundView(w.ctx, 1, false);
  expect(data.financialFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "member_payment", memberId: "sam", name: "Sam", round: 1, paidCents: 10000 }),
    expect.objectContaining({ kind: "collected_total", round: 1, collectedCents: 10000 }),
    expect.objectContaining({ kind: "payout", round: 1, recipientId: expect.any(String), paidOutCents: 0 }),
  ]));
  const privateData = await roundView(w.ctx, 1, false, { role: "member", memberId: "theo" });
  const sam = (privateData.financialFacts as any[]).filter((f) => f.memberId === "sam");
  expect(sam.every((f) => f.paidCents === undefined && f.cents === undefined)).toBe(true);
});

it("keeps exact collected totals, member payments and completed payouts", async () => {
  const w = await paidSam();
  const pot = (await w.store.get<Pot>(keys.pot(1)))!;
  pot.status = "paid";
  await w.store.put(keys.pot(1), pot);
  const recipient = w.circle.members.find((m) => m.id === pot.recipientId)!.name;
  const data = await roundView(w.ctx, 1, false);
  for (const text of ["The pot has $100 paid.", "The circle has collected $100.", "$100 has been collected.", "Sam has paid $100.", `${recipient} received $600.`, "The pot paid out $600."]) {
    const result = applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: data }, w.circle.members.map((m) => m.name));
    expect(result.kept, text).toHaveLength(1);
  }
});

it("rejects counters and numeric strings as money evidence", () => {
  for (const data of [{ round: 1, confirmations: 1, part: 1, count: 1 }, { id: "1", date: "1", count: "1.00" }]) {
    expect(applyDropRule([{ to: "organiser", text: "The pot has $1 paid.", refs: ["r"] }], { r: data }, []).kept).toEqual([]);
  }
});

it("grounds separate clauses instead of borrowing one valid clause", async () => {
  const w = await paidSam();
  const data = await roundView(w.ctx, 1, false);
  const check = (text: string) => applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: data }, w.circle.members.map((m) => m.name));
  expect(check("Sam paid $100 and the pot has $600 paid.").kept).toEqual([]);
  expect(check("Sam paid $100 and the pot has $100 paid.").kept).toHaveLength(1);
  expect(check("Sam paid $100 in round 2.").kept).toEqual([]);
  expect(check("$100 was collected in round 2.").kept).toEqual([]);
});

it("requires exact identities including full names, with no substring backing", () => {
  const data = { name: "Samira", paidCents: 10000, status: "PAID" };
  expect(applyDropRule([{ to: "organiser", text: "Sam paid $100.", refs: ["r"] }], { r: data }, ["Sam", "Samira"]).kept).toEqual([]);
});

it("keeps split part payments and aggregate totals distinct", async () => {
  const w = await world();
  await startCircle(w.ctx);
  const split = await proposeSplit(w.ctx, 1, "sam", 6000);
  await consentSplit(w.ctx, split.split!.id, "sam", "yes");
  const share = (await getShare(w.ctx, 1, "sam"))!;
  w.sb.payInvoice(share.parts[1].invoiceId!);
  await refreshShare(w.ctx, share);
  const data = await roundView(w.ctx, 1, false);
  const check = (text: string) => applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: data }, w.circle.members.map((m) => m.name));
  for (const text of ["Sam paid $40.", "Sam paid $100 in total.", "Sam has not paid $60.", "The pot has $100 paid."]) expect(check(text).kept, text).toEqual([]);
  for (const text of ["Sam paid $60.", "Sam has not paid $40.", "The pot has $60 paid."]) expect(check(text).kept, text).toHaveLength(1);
  expect(check("Sam paid $60 for the part due December 24.").kept).toEqual([]);
  expect(check("Sam paid $60 for the part due December 10.").kept).toHaveLength(1);
  expect(applyDropRule([{ to: "organiser", text: "Sam has $100 due December 24.", refs: ["r", "c"] }], { r: data, c: circleView(w.circle) }, w.circle.members.map((m) => m.name)).kept).toEqual([]);
});

it("distinguishes the planned pot from a share without a payment verb", async () => {
  const w = await world();
  const data = circleView(w.circle);
  const check = (text: string) => applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: data }, w.circle.members.map((m) => m.name));
  expect(check("The pot is $100.").kept).toEqual([]);
  expect(check("The pot is $600.").kept).toHaveLength(1);
  expect(check("Sam has paid $100.").kept).toEqual([]);
});

it("checks localized collective claims and unknown financial subjects", async () => {
  const w = await paidSam();
  const data = await roundView(w.ctx, 1, false);
  const check = (text: string) => applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: data }, w.circle.members.map((m) => m.name));
  for (const text of ["Alice ha pagado $100.", "Alice a payé $100.", "Le pot a $1 payé.", "El fondo tiene $1 pagado."]) expect(check(text).kept, text).toEqual([]);
  for (const text of ["Le cercle a collecté $100.", "Sam ha pagado $100.", "Sam a payé $100."]) expect(check(text).kept, text).toHaveLength(1);
});

it("backs complete names in a rule explanation without accepting name substrings", () => {
  const check = (text: string) => applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: { text: "The confirmers are Dana and Theo. Samira is next." } }, ["Dana", "Theo", "Sam"]);
  expect(check("The confirmers are Dana and Theo.").kept).toHaveLength(1);
  expect(check("Sam is next.").kept).toEqual([]);
});
