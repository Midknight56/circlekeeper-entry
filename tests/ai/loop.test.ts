import { describe, expect, it } from "vitest";
import { runTurn } from "../../src/ai/loop";
import { fitMessages, RecordedModel, type ChatMessage, type Completion, type Model } from "../../src/ai/model";
import { listMessages } from "../../src/circle/messages";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const step = (action: unknown, say: unknown[] = []) => JSON.stringify({ action, say });

describe("the tool loop", () => {
  it("runs a tool, then says only what the tool result backs", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([
      step({ tool: "find_swap_partners", args: { member_id: "sam", wanted_month: "2027-03" } }),
      step(null, [
        { to: "member:sam", text: "Theo holds 2027-03 and the swap fits.", refs: ["call_2"] },
        { to: "member:sam", text: "You owe $250.00 today.", refs: ["call_2"] },
      ]),
    ]);
    const out = await runTurn(w.ctx, model, { role: "member", memberId: "sam" }, "can I take March?");
    expect(out.said.map((m) => m.text)).toEqual(["Theo holds 2027-03 and the swap fits."]);
    expect(out.dropped).toBe(1);
    const log = [...(await w.store.list<any>({ prefix: "log:" })).values()];
    expect(log.some((l) => l.kind === "drop" && /not backed by a tool result/.test(l.note))).toBe(true);
    expect(log.some((l) => l.kind === "tool" && l.tool === "find_swap_partners")).toBe(true);
  });

  it("stops after 4 steps", async () => {
    const w = await world();
    const loopStep = step({ tool: "get_circle", args: {} });
    const model = new RecordedModel([loopStep, loopStep, loopStep, loopStep, loopStep, loopStep]);
    const out = await runTurn(w.ctx, model, { role: "organiser" }, "hello");
    expect(model.calls).toBe(4);
    expect(out.steps).toBe(4);
  });

  it("bad JSON gets one retry, then a fixed line", async () => {
    const w = await world();
    const model = new RecordedModel(["not json at all", "still not json"]);
    const out = await runTurn(w.ctx, model, { role: "member", memberId: "amelie" }, "bonjour");
    expect(model.calls).toBe(2);
    expect(out.said).toHaveLength(1);
    expect(out.said[0].to).toBe("member:amelie");
    expect(out.said[0].text.length).toBeGreaterThan(5);
  });

  it("a member's private chat never posts to the group or to another member", async () => {
    const w = await world();
    const model = new RecordedModel([
      step(null, [
        { to: "group", text: "Thanks for asking.", refs: [] },
        { to: "theo", text: "Dana wants your turn.", refs: [] },
        { to: "dana", text: "I asked around.", refs: [] },
      ]),
    ]);
    const out = await runTurn(w.ctx, model, { role: "member", memberId: "dana" }, "hi");
    expect(out.said.map((m) => [m.to, m.text])).toEqual([["member:dana", "I asked around."]]);
    const keisha = await listMessages(w.ctx, { memberId: "keisha" });
    expect(keisha.some((m) => m.from === "treasurer")).toBe(false);
  });

  it("words said while a tool is still running are not shown", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([
      step({ tool: "get_round", args: { round: 1 } }, [{ to: "member:sam", text: "Checking now.", refs: [] }]),
      step(null, [{ to: "member:sam", text: "Here is your round.", refs: [] }]),
    ]);
    const out = await runTurn(w.ctx, model, { role: "member", memberId: "sam" }, "status?");
    expect(out.said.map((m) => m.text)).toEqual(["Here is your round."]);
  });

  it("the circle and the current round are given as call_0 and call_1, so a first answer can cite them", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const model = new RecordedModel([
      step(null, [{ to: "member:keisha", text: "Your turn is in 2027-02, Keisha.", refs: ["call_0"] }]),
    ]);
    const out = await runTurn(w.ctx, model, { role: "member", memberId: "keisha" }, "when is my turn?");
    expect(out.said.map((m) => m.text)).toEqual(["Your turn is in 2027-02, Keisha."]);
  });

  it("keeps the speaker message in the first model call when circle data is large", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const circle = await w.load();
    circle.name += " ".repeat(7000);
    await w.store.put("circle", circle);
    class CaptureModel implements Model {
      calls: ChatMessage[][] = [];
      async complete(messages: ChatMessage[]): Promise<Completion> {
        this.calls.push(fitMessages(messages));
        return { text: step(null), inputTokens: 0, outputTokens: 0, neurons: 0, recorded: false };
      }
    }
    const model = new CaptureModel();
    await runTurn(w.ctx, model, { role: "member", memberId: "sam" }, "Solo tengo 60 esta semana.");
    expect(model.calls[0].reduce((n, message) => n + message.content.length, 0)).toBe(8000);
    expect(model.calls[0][1].content).toContain("Writing to you:");
    expect(model.calls[0][1].content).toContain("Solo tengo 60 esta semana.");
  });

  it("a recorded run is labelled recorded and costs 0 neurons", async () => {
    const w = await world();
    const model = new RecordedModel([step(null, [{ to: "organiser", text: "Hello.", refs: [] }])]);
    const out = await runTurn(w.ctx, model, { role: "organiser" }, "hi");
    expect(out.neurons).toBe(0);
    expect(out.said[0].recorded).toBe(true);
  });
});

describe("repeated sentences", () => {
  it("the same sentence said in two steps reaches the member once", async () => {
    const w = await world();
    const line = { to: "member:amelie", text: "Ton tour est en avril, Amélie.", refs: ["call_0"] };
    const model = new RecordedModel([step(null, [line, { ...line, refs: ["call_0"] }])]);
    const out = await runTurn(w.ctx, model, { role: "member", memberId: "amelie" }, "Quand est mon tour ?");
    expect(out.said.map((m) => m.text)).toEqual(["Ton tour est en avril, Amélie."]);
  });
});
