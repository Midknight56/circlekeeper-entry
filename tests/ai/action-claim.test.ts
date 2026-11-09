import { describe, expect, it } from "vitest";
import { actionClaim } from "../../src/ai/drop";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const step = (action: unknown, say: unknown[] = []) => JSON.stringify({ action, say });
const names = ["Marisol", "Dana", "Theo", "Sam", "Keisha", "Amélie"];

describe("actionClaim", () => {
  it.each([
    ["I'll propose a swap for you.", "swap"],
    ["I asked Theo privately about taking March 2027.", "swap"],
    ["I've proposed a turn change with Keisha.", "swap"],
    ["Le pregunté a Theo por el cambio de turno.", "swap"],
    ["Voy a proponer un intercambio con Dana.", "swap"],
    ["J'ai demandé à Dana pour l'échange.", "swap"],
    ["Je vais proposer un échange de tours.", "swap"],
    ["I've proposed a split: $60 now and $40 later.", "split"],
    ["Te propongo dividir tu parte en dos partes.", "split"],
    ["J'ai proposé de diviser ta part en deux.", "split"],
    ["I sent a reminder to Sam.", "reminder"],
    ["Envié un recordatorio a Sam.", "reminder"],
    ["J'ai envoyé un rappel à Sam.", "reminder"],
    ["I moved your turn to March.", "move"],
    ["Moví tu turno a marzo.", "move"],
    ["J'ai déplacé ton tour en mars.", "move"],
  ])("%s claims %s", (sentence, family) => {
    expect(actionClaim(sentence, names)).toBe(family);
  });

  it.each([
    "Would you like me to propose a swap?",
    "¿Quieres que proponga un cambio de turno?",
    "Voulez vous que je propose un échange?",
    "Your turn is in April 2027.",
    "I asked around.",
  ])("%s is not a claim", (sentence) => {
    expect(actionClaim(sentence, names)).toBeNull();
  });
});

describe("the loop drops an action claim no tool backs", () => {
  const dana = { role: "member" as const, memberId: "dana" };
  const ask = "My rent went up. Can I take March instead of May?";

  it("drops a swap claim when no tool ran", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([step(null, [{ to: "dana", text: "I'll propose a swap for you.", refs: [] }])]);
    const out = await runTurn(w.ctx, model, dana, ask);
    expect(out.said.map((m) => m.text)).not.toContain("I'll propose a swap for you.");
    const log = [...(await w.store.list<any>({ prefix: "log:" })).values()];
    expect(log.some((l) => l.kind === "drop" && l.note === 'dropped: claims an action that did not happen ("swap") in "I\'ll propose a swap for you."')).toBe(true);
  });

  it("keeps a swap claim after propose_swap succeeded in the same turn", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([
      step({ tool: "propose_swap", args: { from_member: "dana", to_member: "theo" } }),
      step(null, [{ to: "dana", text: "I asked Theo privately about taking March 2027.", refs: ["call_2"] }]),
    ]);
    const out = await runTurn(w.ctx, model, dana, ask);
    expect(out.said.map((m) => m.text)).toContain("I asked Theo privately about taking March 2027.");
  });

  it("drops a swap claim when propose_swap was refused", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([
      step({ tool: "propose_swap", args: { from_member: "dana", to_member: "keisha" } }),
      step(null, [{ to: "dana", text: "I've proposed a swap for you.", refs: ["call_2"] }]),
    ]);
    const out = await runTurn(w.ctx, model, dana, ask);
    expect(out.said.map((m) => m.text)).not.toContain("I've proposed a swap for you.");
  });

  it("always drops a claim that the treasurer moved a turn", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([
      step({ tool: "propose_swap", args: { from_member: "dana", to_member: "theo" } }),
      step(null, [{ to: "dana", text: "I moved your turn.", refs: ["call_2"] }]),
    ]);
    const out = await runTurn(w.ctx, model, dana, ask);
    expect(out.said.map((m) => m.text)).not.toContain("I moved your turn.");
  });
});
