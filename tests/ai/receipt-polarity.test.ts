import { expect, it } from "vitest";
import { applyDropRule } from "../../src/ai/drop";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { keys, type Pot } from "../../src/circle/model";
import { recordCashShare, startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const pairs = [
  ["Marisol has received $600.", "Marisol has not received $600."],
  ["The pot has paid out $600.", "The pot has not paid out $600."],
  ["Marisol ha recibido $600.", "Marisol no ha recibido $600."],
  ["El fondo ha desembolsado $600.", "El fondo no ha desembolsado $600."],
  ["Marisol a reçu $600.", "Marisol n'a pas reçu $600."],
  ["Le pot a versé $600.", "Le pot n'a pas versé $600."],
  ["Marisol has received.", "Marisol has not received."],
];
for (const completed of [false, true]) {
  it(`checks receipt and payout polarity through the full turn with completed=${completed}`, async () => {
    const w = await world();
    await startCircle(w.ctx);
    if (completed) {
      for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
      await confirmRelease(w.ctx, 1, "dana");
      await confirmRelease(w.ctx, 1, "theo");
      const pot = (await w.store.get<Pot>(keys.pot(1)))!;
      await onPayoutEvent(w.ctx, pot.payoutBatchId!);
    }
    for (const pair of pairs) for (const [i, text] of pair.entries()) {
      const model = new RecordedModel([
        JSON.stringify({ action: { tool: "get_round", args: { round: 1 } } }),
        JSON.stringify({ say: [{ to: "organiser", text, refs: ["call_2"] }] }),
      ]);
      const out = await runTurn(w.ctx, model, { role: "organiser" }, "Has the pot arrived?");
      const supported = completed === (i === 0);
      expect(out.dropped, text).toBe(supported ? 0 : 1);
      expect(out.said.some((s) => s.text === text), text).toBe(supported);
    }
  });
}

it("rejects receipt and payout denials without a known unsent payout fact", () => {
  for (const data of [
    { cents: 60000, status: "UNPAID" },
    ...["paying", "failed", "unknown"].map((status) => ({ financialFacts: [
      { kind: "payout", round: 1, recipientId: "marisol", name: "Marisol", cents: 60000, paidOutCents: 0, status },
    ] })),
  ]) for (const pair of pairs) {
    const text = pair[1];
    expect(applyDropRule([{ to: "organiser", text, refs: ["r"] }], { r: data }, ["Marisol"]).kept, text).toEqual([]);
  }
});
