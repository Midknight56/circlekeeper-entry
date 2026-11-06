import { describe, expect, it } from "vitest";
import { CappedModel, TreasurerResting, WorkersAiModel, type VisitorCaps } from "../../src/ai/model";
import { MemoryLedger } from "../../src/ai/ledger";
import { DAILY_NEURONS, MAX_AI_CALLS_PER_VISITOR_DAY, worstCaseNeurons } from "../../src/caps";

function fakeAi() {
  const calls: unknown[] = [];
  return {
    calls,
    run: async (_model: string, input: unknown) => {
      calls.push(input);
      return { choices: [{ message: { content: '{"action":null,"say":[]}' } }], usage: { prompt_tokens: 500, completion_tokens: 40 } };
    },
  };
}

class MemoryCaps implements VisitorCaps {
  n = new Map<string, number>();
  async take(visitor: string, day: string, what: string, limit: number) {
    const k = `${visitor}:${day}:${what}`;
    const v = this.n.get(k) || 0;
    if (v >= limit) return false;
    this.n.set(k, v + 1);
    return true;
  }
}

const msgs = [
  { role: "system" as const, content: "x".repeat(2000) },
  { role: "user" as const, content: "hello" },
];

describe("neuron caps", () => {
  it("the worst case call is 7.15 neurons", () => {
    expect(worstCaseNeurons(8000, 400)).toBe(7.15);
  });

  it("the call that would pass 700 neurons is refused before the model runs", async () => {
    const ai = fakeAi();
    const ledger = new MemoryLedger();
    ledger.rows.push({ id: "x", app: "circlekeeper", day: "2026-12-01", neurons: DAILY_NEURONS - 1 });
    const model = new WorkersAiModel(ai, ledger, () => "2026-12-01");
    await expect(model.complete(msgs, 400)).rejects.toBeInstanceOf(TreasurerResting);
    expect(ai.calls).toHaveLength(0);
  });

  it("the account guard refuses when other apps have used the day", async () => {
    const ai = fakeAi();
    const ledger = new MemoryLedger();
    ledger.rows.push({ id: "x", app: "other-app", day: "2026-12-01", neurons: 9499 });
    const model = new WorkersAiModel(ai, ledger, () => "2026-12-01");
    await expect(model.complete(msgs, 400)).rejects.toBeInstanceOf(TreasurerResting);
    expect(ai.calls).toHaveLength(0);
  });

  it("a call is charged its worst case first, then settled to what it used", async () => {
    const ai = fakeAi();
    const ledger = new MemoryLedger();
    const model = new WorkersAiModel(ai, ledger, () => "2026-12-01");
    const out = await model.complete(msgs, 400);
    // 500 x 1,542 / 1e6 + 40 x 10,158 / 1e6 = 0.77 + 0.41 = 1.18
    expect(out.neurons).toBe(1.18);
    expect(await ledger.spent("circlekeeper", "2026-12-01")).toBe(1.18);
  });

  it("a visitor's 7th call is refused", async () => {
    const ai = fakeAi();
    const caps = new MemoryCaps();
    const model = new CappedModel(new WorkersAiModel(ai, new MemoryLedger(), () => "d"), caps, "visitor-hash", () => "d", MAX_AI_CALLS_PER_VISITOR_DAY);
    for (let i = 0; i < 6; i++) await model.complete(msgs, 400);
    await expect(model.complete(msgs, 400)).rejects.toBeInstanceOf(TreasurerResting);
    expect(ai.calls).toHaveLength(6);
  });
});
