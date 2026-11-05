import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { confirmRelease, retryPayout, recoverPayout } from "../../src/circle/gate";
import { keys, type Pot } from "../../src/circle/model";
import { recordCashShare, startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";
import { sandbox } from "../helpers/sandbox";
import worker from "../../src/worker";
import circleSource from "../../public/js/circle.js?raw";

async function ready() {
  const w = await world();
  await startCircle(w.ctx);
  for (const member of w.circle.members) await recordCashShare(w.ctx, 1, member.id);
  w.ctx.visitor = "net-a";
  return w;
}

async function release(w: Awaited<ReturnType<typeof ready>>) {
  await confirmRelease(w.ctx, 1, "dana");
  return confirmRelease(w.ctx, 1, "theo");
}

describe("per network live pot limit", () => {
  it("shows the live pot limit sentence on the board", () => {
    expect(circleSource).toContain("This network has used today's 3 live pots. This pot was not sent. Try again after 00:00 UTC.");
    expect(circleSource).toContain('refusal === "NETWORK_POT_LIMIT"');
  });

  it("refuses a pot before PayPal and the payout day cap, while another network can send", async () => {
    let slots = 0;
    const configure = (w: Awaited<ReturnType<typeof ready>>, visitor = "net-a") => {
      w.ctx.visitor = visitor;
      w.ctx.hub.takeLivePot = async () => ++slots <= 3;
      w.ctx.hub.takePayout = vi.fn(async () => true);
    };
    for (let i = 0; i < 3; i++) {
      const sent = await ready(); configure(sent);
      expect((await release(sent)).ok).toBe(true);
    }
    const w = await ready(); configure(w);
    const calls = vi.spyOn(w.ctx.pp, "request");
    const result = await release(w);
    expect(result).toMatchObject({ ok: false, error: "This network has used today's 3 live pots. This pot was not sent. Try again after 00:00 UTC." });
    expect(await w.store.get<Pot>(keys.pot(1))).toMatchObject({ status: "failed", refusal: "NETWORK_POT_LIMIT" });
    expect(calls.mock.calls.filter(([method, path]) => method === "POST" && path === "/v1/payments/payouts")).toHaveLength(0);
    expect(w.ctx.hub.takePayout).not.toHaveBeenCalled();
    const other = await ready();
    other.ctx.visitor = "net-b";
    other.ctx.hub.takeLivePot = async () => true;
    expect((await release(other)).ok).toBe(true);
  });

  // Four whole circles through the worker make this exceed Vitest's default timeout in parallel runs.
  it("routes confirm and retry through the worker with the connecting address", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const sameAddress = "198.51.100.171";
    const otherAddress = "198.51.100.172";
    const request = (path: string, ip: string, body?: unknown) => worker.fetch(new Request(`https://ck.test${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "cf-connecting-ip": ip, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, {} as ExecutionContext);
    const circles: { id: string; organiserToken: string; memberLinks: { memberId: string; url: string }[] }[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await request("/api/demo", sameAddress, {});
      expect(response.status).toBe(200);
      circles.push(await response.json() as any);
    }
    const confirmers = ["dana", "theo"];
    let fourthLastConfirm: Response | undefined;
    for (const [index, circle] of circles.entries()) {
      expect((await request(`/api/circles/${circle.id}/start`, sameAddress, { k: circle.organiserToken })).status).toBe(200);
      for (const member of ["keisha", "marisol", "dana", "theo", "amelie", "sam"]) {
        expect((await request(`/api/circles/${circle.id}/shares/1/${member}/cash`, sameAddress, { k: circle.organiserToken })).status).toBe(200);
      }
      const byId = new Map(circle.memberLinks.map((m) => [m.memberId, m.url.split("/").pop()!]));
      for (const memberId of confirmers) {
        const response = await request(`/api/circles/${circle.id}/rounds/1/release/confirm`, sameAddress, { k: byId.get(memberId) });
        if (index === 3 && memberId === "theo") fourthLastConfirm = response;
        else expect(response.status).toBe(200);
      }
    }
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(3);
    expect(fourthLastConfirm?.status).toBe(409);
    expect(await fourthLastConfirm!.text()).toContain("This network has used today's 3 live pots. This pot was not sent. Try again after 00:00 UTC.");
    const fourth = circles[3];
    const state = await request(`/api/circles/${fourth.id}/state?k=${fourth.organiserToken}`, sameAddress);
    const stateBody = await state.json() as any;
    expect(stateBody.rounds.find((round: any) => round.round === 1)?.pot).toMatchObject({ refusal: "NETWORK_POT_LIMIT", status: "failed" });
    const retryPath = `/api/circles/${fourth.id}/rounds/1/release/retry`;
    const deniedRetry = await request(retryPath, sameAddress, { k: fourth.organiserToken });
    expect(deniedRetry.status).toBe(409);
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(3);
    expect((await request(retryPath, otherAddress, { k: fourth.organiserToken })).status).toBe(200);
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(4);
    }, 20000);

  it("can retry the refused pot after the next day with its saved sender id", async () => {
    const w = await ready();
    w.ctx.hub.takeLivePot = async (_v, day) => day !== "2026-12-01";
    await release(w);
    const original = (await w.store.get<Pot>(keys.pot(1)))!.senderBatchId;
    w.setNow("2026-12-02T15:00:00Z");
    const result = await retryPayout(w.ctx, 1);
    expect(result.ok).toBe(true);
    expect(await w.store.get<Pot>(keys.pot(1))).toMatchObject({ senderBatchId: original, status: "paying" });
    expect((await w.store.get<Pot>(keys.pot(1)))?.refusal).toBeUndefined();
  });

  it("keeps a slot for a PayPal refusal retry and uses no slot for recovery", async () => {
    const w = await ready();
    let slots = 0;
    w.ctx.hub.takeLivePot = async () => { slots++; return true; };
    w.sb.failNextPayout(400, "INVALID_REQUEST");
    await release(w);
    expect(slots).toBe(1);
    await retryPayout(w.ctx, 1);
    expect(slots).toBe(1);
    const pot = (await w.store.get<Pot>(keys.pot(1)))!;
    pot.status = "paying"; pot.sentBy = "main"; pot.lastSendAt = undefined;
    await w.store.put(keys.pot(1), pot);
    await recoverPayout(w.ctx, pot);
    expect(slots).toBe(1);
  });

  it("still asks the day cap when the visitor has a slot", async () => {
    const w = await ready();
    w.ctx.hub.takeLivePot = async () => true;
    w.ctx.hub.takePayout = async () => false;
    const result = await release(w);
    expect(result).toMatchObject({ ok: false, error: "today's sandbox payout limit is reached; try again tomorrow" });
  });

  it("does not take a second slot when the day cap refused a pot that already got one", async () => {
    const w = await ready();
    let slots = 0;
    w.ctx.hub.takeLivePot = async () => { slots++; return true; };
    w.ctx.hub.takePayout = async () => false;
    await release(w);
    expect(slots).toBe(1);
    w.ctx.hub.takePayout = async () => true;
    await retryPayout(w.ctx, 1);
    expect(slots).toBe(1);
  });
});
