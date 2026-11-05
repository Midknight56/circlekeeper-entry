import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import worker from "../../src/worker";

async function setup() {
  const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
  await stub.create(circle);
  return { circle, stub };
}

function ask(circle: any, k: string, from: string, to: string) {
  return worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/swaps`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k, from, to }),
  }), env, {} as ExecutionContext);
}

const state = async (stub: any, key: string) => (await stub.state("https://ck.test", key)).body;
const roundOf = (board: any, who: string) => board.circle.rotation.find((slot: any) => slot.memberId === who).round;

describe("organiser swap asks", () => {
  it("lets the organiser ask two members, then changes turns only after both say yes", async () => {
    const { circle, stub } = await setup();
    const before = await state(stub, circle.organiserToken);
    const response = await ask(circle, circle.organiserToken, "dana", "theo");
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.ok).toBe(true);
    const pending = await state(stub, circle.organiserToken);
    const swap = pending.swaps.find((item: any) => item.status === "asked");
    expect(swap).toMatchObject({ from: "dana", to: "theo" });
    expect(roundOf(pending, "dana")).toBe(roundOf(before, "dana"));
    expect(roundOf(pending, "theo")).toBe(roundOf(before, "theo"));

    const first = await worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/swaps/${swap.id}/consent`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: circle.members.find((m: any) => m.id === "dana")!.token, answer: "yes" }),
    }), env, {} as ExecutionContext);
    expect(first.status).toBe(200);
    let middle = await state(stub, circle.organiserToken);
    expect(roundOf(middle, "dana")).toBe(roundOf(before, "dana"));
    expect(roundOf(middle, "theo")).toBe(roundOf(before, "theo"));

    const second = await worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/swaps/${swap.id}/consent`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: circle.members.find((m: any) => m.id === "theo")!.token, answer: "yes" }),
    }), env, {} as ExecutionContext);
    expect(second.status).toBe(200);
    middle = await state(stub, circle.organiserToken);
    expect(roundOf(middle, "dana")).toBe(roundOf(before, "theo"));
    expect(roundOf(middle, "theo")).toBe(roundOf(before, "dana"));
  });

  it("refuses a member key and a wrong key", async () => {
    const { circle } = await setup();
    const memberKey = circle.members.find((m: any) => m.id === "dana")!.token;
    expect((await ask(circle, memberKey, "dana", "theo")).status).toBe(403);
    expect((await ask(circle, "wrong-key", "dana", "theo")).status).toBe(403);
  });

  it("returns the need reason when the proposed swap breaks a need", async () => {
    const { circle } = await setup();
    const response = await ask(circle, circle.organiserToken, "dana", "keisha");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("that swap breaks a stated need: Keisha needs 2027-02") });
  });
});
