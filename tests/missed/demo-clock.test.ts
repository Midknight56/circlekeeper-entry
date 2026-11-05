import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_PAYOUT_CENTS_PER_DAY } from "../../src/caps";
import { PayPal } from "../../src/paypal/client";
import { startCircle, recordCashShare } from "../../src/circle/shares";
import worker from "../../src/worker";
import { world } from "../helpers/world";

afterEach(() => { vi.restoreAllMocks(); PayPal.resetMemory(); });

async function prepared(day: number, demo = true, paid = true) {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-01T15:00:00Z"));
  const w = await world();
  w.circle.id = w.ctx.circleId = crypto.randomUUID().slice(0, 10);
  w.circle.demo = demo;
  w.circle.rules.missed.action = "pot_waits";
  await w.store.put("circle", w.circle);
  await startCircle(w.ctx);
  if (paid) for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
  const pot = (await w.store.get<any>("pot:01"))!;
  pot.waitUntil = "2026-12-23";
  await w.store.put("pot:01", pot);
  await w.store.put("demo:offsetDays", day - 1);
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => w.sb.fetchFn(input as any, init));
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(w.circle.id));
  await stub.create(await w.load());
  await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
    for (const [key, value] of w.store.data) await state.storage.put(key, value);
    await state.storage.put("refreshedAt", Date.now());
  });
  const post = (path: string, body: object) => worker.fetch(new Request(`https://ck.test/api/circles/${w.circle.id}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, {} as ExecutionContext);
  return { ...w, stub, post };
}

it("both confirmers release a paid demo pot after the agreed date", async () => {
  const w = await prepared(24);
  expect((await w.stub.confirm("https://ck.test", "tok-dana", 1, "v")).status).toBe(200);
  expect((await w.stub.confirm("https://ck.test", "tok-theo", 1, "v")).status).toBe(200);
  expect(w.sb.payouts.size).toBe(1);
});

it("the demo pot still refuses release before the agreed date", async () => {
  const w = await prepared(22);
  await w.stub.confirm("https://ck.test", "tok-dana", 1, "v");
  const result = await w.stub.confirm("https://ck.test", "tok-theo", 1, "v") as unknown as { status: number; body: { error: string } };
  expect(result.status).toBe(409);
  expect(result.body.error).toContain("December 23");
  expect(w.sb.payouts.size).toBe(0);
});

it("skips exactly to the wait date and keeps the payment gate", async () => {
  const w = await prepared(22, true, false);
  expect((await w.post("demo/skip-to-wait", { k: "tok-dana" })).status).toBe(403);
  expect((await w.post("demo/skip-to-wait", { k: "org" })).status).toBe(200);
  const state = await w.stub.state("https://ck.test", "org") as unknown as { body: { now: string } };
  expect(state.body.now.slice(0, 10)).toBe("2026-12-23");
  expect((await w.stub.confirm("https://ck.test", "tok-dana", 1, "v")).status).toBe(409);
  expect(w.sb.payouts.size).toBe(0);
  expect((await w.post("demo/skip-to-wait", { k: "org" })).status).toBe(409);
});

it("refuses a wait date skip for a real circle", async () => {
  const w = await prepared(22, false);
  expect((await w.post("demo/skip-to-wait", { k: "org" })).status).toBe(409);
});

it("retry uses the same demo clock after the wait date", async () => {
  const w = await prepared(24);
  await runInDurableObject(w.stub, async (_instance: unknown, state: DurableObjectState) => {
    const pot = (await state.storage.get<any>("pot:01"))!;
    pot.status = "failed";
    pot.confirmations = ["dana", "theo"].map((memberId) => ({ memberId, at: "2026-12-24T15:00:00Z" }));
    await state.storage.put("pot:01", pot);
  });
  expect((await w.stub.retry("https://ck.test", "org", 1, "v")).status).toBe(200);
  expect(w.sb.payouts.size).toBe(1);
});

it("uses the real UTC day for the shared payout cap despite a demo date skip", async () => {
  const w = await prepared(31);
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const payoutCap = Number(env.LOCAL_PAYOUT_CAP_CENTS) || MAX_PAYOUT_CENTS_PER_DAY;
  const day = new Date();
  const capDays: string[] = [];
  for (let i = 0; i <= 40; i++) {
    capDays.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  await runInDurableObject(hub, async (_instance: unknown, state: DurableObjectState) => {
    for (const keyDay of capDays) await state.storage.put(`cap:payout:${keyDay}`, payoutCap);
  });
  await w.stub.confirm("https://ck.test", "tok-dana", 1, "v");
  const result = await w.stub.confirm("https://ck.test", "tok-theo", 1, "v") as unknown as { status: number; body: { error: string } };
  expect(result.status).toBe(409);
  expect(result.body.error).toContain("sandbox payout limit");
  expect(w.sb.payouts.size).toBe(0);
});

it("records a demo card payment with the real date", async () => {
  const w = await prepared(31, true, false);
  const result = await w.stub.card("https://ck.test", "tok-keisha", 1, "keisha");
  expect(result.status).toBe(200);
  const payment = w.sb.calls("POST /v2/invoicing/invoices/").find((call) => call.path.endsWith("/payments"));
  expect(payment?.body.payment_date).toBe(new Date().toISOString().slice(0, 10));
});
