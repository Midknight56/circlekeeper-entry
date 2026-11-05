import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import { PayPal } from "../../src/paypal/client";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";
// @ts-ignore shared state based member selection
import { lateMember } from "../../dev/late-member.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

describe("missed share check route", () => {
  it("keeps the skipped demo date for the board and both later votes", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const demo = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(demo.id));
    await stub.create(demo);
    await stub.start("https://ck.test", demo.organiserToken);
    const before: any = (await stub.state("https://ck.test", demo.organiserToken)).body;
    const late = lateMember(before, 1);
    for (const m of demo.members.filter((m) => m.id !== late)) await stub.cash("https://ck.test", demo.organiserToken, 1, m.id);
    expect((await stub.checkMissed("https://ck.test", demo.organiserToken)).status).toBe(200);
    const asked: any = (await stub.state("https://ck.test", demo.organiserToken)).body;
    expect(asked.now.slice(0, 10) > asked.rounds[0].shares[0].parts[0].dueDate).toBe(true);
    const missed = asked.missed.find((m: any) => m.status === "asked");
    expect(missed.plan.action).toBe("move_to_end");
    for (const id of demo.rules.confirmers) {
      expect((await stub.consentMissed("https://ck.test", demo.members.find((m) => m.id === id)!.token, missed.id, "yes")).status).toBe(200);
    }
    const after: any = (await stub.state("https://ck.test", demo.organiserToken)).body;
    expect(after.missed.find((m: any) => m.id === missed.id).status).toBe("applied");
    // The demo clock moves by whole days and keeps running, so the date holds, not the instant.
    expect(after.now.slice(0, 10)).toBe(asked.now.slice(0, 10));
  });

  it("is limited to the organiser and demo circles", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const demo = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(demo.id));
    await stub.create(demo);
    await stub.start("https://ck.test", demo.organiserToken);
    const post = (id: string, k: string) => worker.fetch(new Request(`https://ck.test/api/circles/${id}/missed/check`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k }),
    }), env, {} as ExecutionContext);
    expect((await post(demo.id, demo.members[0].token)).status).toBe(403);
    expect((await post(demo.id, demo.organiserToken)).status).toBe(200);

    const regular = draftCircle(DEMO_TEXT, "2026-10-23", { startMonth: DEMO_START_MONTH }).circle!;
    await env.CIRCLE.get(env.CIRCLE.idFromName(regular.id)).create(regular);
    expect((await post(regular.id, regular.organiserToken)).status).toBe(409);
  });
});
