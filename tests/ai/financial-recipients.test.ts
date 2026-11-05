import { expect, it } from "vitest";
import { applyDropRule } from "../../src/ai/drop";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { keys, type Pot } from "../../src/circle/model";
import { recordCashShare, startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

async function paidRound() {
  const w = await world();
  await startCircle(w.ctx);
  for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
  await confirmRelease(w.ctx, 1, "dana");
  await confirmRelease(w.ctx, 1, "theo");
  const pot = (await w.store.get<Pot>(keys.pot(1)))!;
  await onPayoutEvent(w.ctx, pot.payoutBatchId!);
  expect((await w.store.get<Pot>(keys.pot(1)))!.status).toBe("paid");
  return w;
}

const reply = (text: string) => new RecordedModel([
  JSON.stringify({ action: { tool: "get_round", args: { round: 1 } } }),
  JSON.stringify({ say: [{ to: "organiser", text, refs: ["call_2"] }] }),
]);

for (const recipient of ["alice", "Alice", "aLiCe", "sam", "SAM", "marisol smith", "Marisol Smith"]) {
  it(`rejects an unsupported payout recipient through the full turn: ${recipient}`, async () => {
    const w = await paidRound();
    const text = `The pot paid out $600 to ${recipient}.`;
    const out = await runTurn(w.ctx, reply(text), { role: "organiser" }, "Who received the pot?");
    expect(out.dropped).toBe(1);
    expect(out.said.some((s) => s.text === text)).toBe(false);
  });
}

it("keeps the actual payout recipient in every capitalisation through the full turn", async () => {
  const w = await paidRound();
  for (const recipient of ["Marisol", "marisol", "MARISOL", "mArIsOl"]) {
    const text = `The pot paid out $600 to ${recipient}.`;
    const out = await runTurn(w.ctx, reply(text), { role: "organiser" }, "Who received the pot?");
    expect(out.dropped, text).toBe(0);
    expect(out.said.map((s) => s.text), text).toContain(text);
  }
});

const names = ["Sam Li", "Sam Diaz", "Marisol Vega"];
const facts = [
  { kind: "member_payment", round: 1, memberId: "sam", name: "Sam Li", cents: 10000, paidCents: 10000, status: "PAID" },
  { kind: "payout", round: 1, recipientId: "marisol", name: "Marisol Vega", cents: 60000, paidOutCents: 60000, status: "paid" },
];
const check = (text: string) => applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: { financialFacts: facts } }, names);

it("resolves payer and recipient roles against complete identities", () => {
  for (const text of [
    "The pot paid out $600 to alice.", "The pot paid out $600 to marisol.",
    "The pot paid out $600 to marisol vega smith.", "The pot paid out $600 to sam li.",
    "The pot paid out $600 to marisol vega by sam li.",
    "$100 was paid by alice.", "$100 was paid by sam diaz.",
    "sam li paid $100 to alice.", "sam li paid $100 to marisol vega.",
    "The pot paid out $600 to marisol vega and alice.",
    "The pot paid out $600 to marisol vega, alice.",
    "$100 was paid by sam li, alice.",
  ]) expect(check(text).kept, text).toEqual([]);
  for (const text of [
    "The pot paid out $600 to marisol vega.", "marisol vega received $600.",
    "$100 was paid by sam li.", "sam li paid $100 to the circle.",
  ]) expect(check(text).kept, text).toHaveLength(1);
});

it("preserves complete member names containing role words, numbers, accents and apostrophes", () => {
  for (const name of ["Sam To Li", "Member 1", "Amélie D'Arcy", "Anne-Marie Li"]) {
    const result = applyDropRule([{ to: "organiser", text: `The pot paid out $600 to ${name.toLowerCase()}.`, refs: ["r"] }],
      { r: { financialFacts: [{ ...facts[1], name }] } }, [name]);
    expect(result.kept, name).toHaveLength(1);
  }
});

it("checks explicit localized financial recipients without using letter case", () => {
  for (const text of ["Le pot a versé $600 à alice.", "Le pot a versé $600 à sam li.", "Le pot a versé $600 à marisol."]) {
    expect(check(text).kept, text).toEqual([]);
  }
  expect(check("Le pot a versé $600 à marisol vega.").kept).toHaveLength(1);
});

it("keeps a supported share frequency without treating its unit as a recipient", () => {
  const result = applyDropRule([{ to: "organiser", text: "Each pays $100 a month.", refs: ["r"] }],
    { r: { financialFacts: [{ kind: "share_amount", round: 1, memberId: "sam", name: "Sam Li", cents: 10000 }] } }, names);
  expect(result.kept).toHaveLength(1);
});

for (const gap of ["directly", "yesterday", "quickly and safely", "after checking the account"]) {
  it(`resolves payout recipients across intervening words: ${gap}`, async () => {
    const w = await paidRound();
    for (const recipient of ["alice", "sam", "Marisol Smith", "Marisol"]) {
      const text = `The pot paid out $600 ${gap} to ${recipient}.`;
      const out = await runTurn(w.ctx, reply(text), { role: "organiser" }, "Who received the pot?");
      expect(out.dropped, text).toBe(recipient === "Marisol" ? 0 : 1);
      expect(out.said.some((s) => s.text === text), text).toBe(recipient === "Marisol");
    }
  });
}
