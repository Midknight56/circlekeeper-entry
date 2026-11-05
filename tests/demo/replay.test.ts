import { describe, expect, it } from "vitest";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { RECORDED, findRecorded, suggestions, DEMO_TEXT } from "../../src/demo";
import { startCircle } from "../../src/circle/shares";
import { demoWorld } from "../helpers/world";
import FILE from "../../samples/demo-recorded.json";

const liveDrops = (key: string) => (FILE.turns as Record<string, { liveDrops: number }>)[key].liveDrops;

describe("the recorded demo", () => {
  it("every recorded turn plays at 0 neurons and drops exactly what the live run dropped", async () => {
    const w = await demoWorld();
    const order = ["setup", "keisha-share", "amelie-turn", "theo-release"];
    const setup = RECORDED.find((r) => r.key === "setup")!;
    let out = await runTurn(w.ctx, new RecordedModel(setup.steps), { role: "organiser" }, setup.text);
    expect(out.neurons).toBe(0);
    expect(out.dropped).toBe(liveDrops("setup"));
    await startCircle(w.ctx);
    for (const key of [...order.slice(1), "marisol-short", "dana-swap", "organiser-remind"]) {
      const r = RECORDED.find((x) => x.key === key)!;
      const model = new RecordedModel(r.steps);
      const speaker = r.speaker === "organiser" ? ({ role: "organiser" } as const) : ({ role: "member", memberId: r.speaker } as const);
      out = await runTurn(w.ctx, model, speaker, r.text);
      expect({ key, neurons: out.neurons, dropped: out.dropped, refused: out.refused }).toEqual({ key, neurons: 0, dropped: liveDrops(key), refused: [] });
      expect(out.said.length).toBeGreaterThan(0);
      expect(out.recorded).toBe(true);
      expect(model.calls).toBe(r.steps.length);
    }
  });

  it("the recorded turns are found by speaker and text, with accents and case ignored", () => {
    expect(findRecorded("marisol", "solo tengo 60 esta semana")?.key).toBe("marisol-short");
    expect(findRecorded("amelie", "Quand est mon tour")?.key).toBe("amelie-turn");
    expect(findRecorded("dana", "Solo tengo 60 esta semana.")).toBeUndefined();
    expect(findRecorded("organiser", DEMO_TEXT)?.key).toBe("setup");
  });

  it("each demo member with a recorded turn gets it as a suggestion", () => {
    expect(suggestions("marisol")).toEqual(["Solo tengo 60 esta semana."]);
    expect(suggestions("organiser")).toEqual(["Send Sam a kind reminder.", "What if Theo leaves in March?"]);
  });
});
