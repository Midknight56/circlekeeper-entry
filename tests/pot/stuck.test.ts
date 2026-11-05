import { createExecutionContext, env, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmRelease, MAX_SEND_TRIES, recoverPayout, refreshPot, RESEND_AFTER_MS, retryPayout } from "../../src/circle/gate";
import { keys, type Pot } from "../../src/circle/model";
import { recordCashShare, startCircle } from "../../src/circle/shares";
import { stateFor } from "../../src/circle/state";
import { PayPal } from "../../src/paypal/client";
import { originalPayoutBatchId } from "../../src/paypal/payouts";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";
import { world } from "../helpers/world";

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

async function claimed(accepted = false) {
  const w = await world();
  await startCircle(w.ctx);
  for (const member of w.circle.members) await recordCashShare(w.ctx, 1, member.id);
  await confirmRelease(w.ctx, 1, "dana");
  const request = w.ctx.pp.request.bind(w.ctx.pp);
  const stopped = vi.spyOn(w.ctx.pp, "request").mockImplementation(async (method, path, body, opts) => {
    if (!accepted && method === "POST" && path === "/v1/payments/payouts") throw new Error("worker stopped before send");
    return request(method, path, body, opts);
  });
  if (accepted) w.sb.loseNextPayoutAnswer();
  await expect(confirmRelease(w.ctx, 1, "theo")).rejects.toThrow(accepted ? "payout answer lost" : "worker stopped before send");
  stopped.mockRestore();
  const pot = (await w.store.get<Pot>(keys.pot(1)))!;
  expect(pot).toMatchObject({ status: "paying", sentBy: "main", sendTries: 1, lastSendAt: w.ctx.now().toISOString() });
  expect(pot.payoutBatchId).toBeUndefined();
  w.setNow(new Date(w.ctx.now().getTime() + 120_000).toISOString());
  return { ...w, pot };
}

function advance(w: Awaited<ReturnType<typeof claimed>>, ms = RESEND_AFTER_MS) {
  w.setNow(new Date(w.ctx.now().getTime() + ms).toISOString());
}

function payoutIds(w: Awaited<ReturnType<typeof claimed>>) {
  return w.sb.calls("POST /v1/payments/payouts").map((s) => ({
    senderBatchId: s.body.sender_batch_header.sender_batch_id,
    requestId: s.headers["paypal-request-id"],
  }));
}

async function readPot(w: Awaited<ReturnType<typeof claimed>>) {
  return (await w.store.get<Pot>(keys.pot(1)))!;
}

function olderApp(w: Awaited<ReturnType<typeof claimed>>) {
  const sb = sandbox();
  w.ctx.payoutPp = new PayPal({ ...(w.ctx.pp as any).env, PAYPAL_CLIENT_ID: "older-app" }, sb.fetchFn, () => w.ctx.now().getTime(), async () => {});
  return sb;
}

async function durableClaim(w: Awaited<ReturnType<typeof claimed>>, id: string) {
  const c = { ...await w.load(), id };
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(id));
  await stub.create(c);
  await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
    for (const [key, share] of await w.store.list({ prefix: "share:" })) await state.storage.put(key, share);
    await state.storage.put(keys.pot(1), { ...w.pot, lastSendAt: new Date(Date.now() - 120_000).toISOString() });
    await state.storage.put("lastActivity", 0);
  });
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => w.sb.fetchFn(input, init));
  return { c, stub };
}

describe("recovery of a claimed payout", () => {
  it("1. sends a claim that died before PayPal got it with the saved identifiers", async () => {
    const w = await claimed();
    const cap = vi.fn(async () => true);
    w.ctx.hub.takePayout = cap;
    const gets = w.sb.calls("GET /v2/invoicing/invoices/").length;
    delete w.pot.lastSendAt;
    await w.store.put(keys.pot(1), w.pot);
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "paying", sentBy: "main", sendTries: 2, lastSendAt: w.ctx.now().toISOString() });
    await refreshPot(w.ctx, await readPot(w));
    expect(await readPot(w)).toMatchObject({ status: "paid", payoutBatchId: [...w.sb.payouts.keys()][0] });
    expect(w.sb.payouts.size).toBe(1);
    expect(payoutIds(w)).toEqual([{ senderBatchId: w.pot.senderBatchId, requestId: w.pot.requestId }]);
    expect(cap).not.toHaveBeenCalled();
    expect(w.sb.calls("GET /v2/invoicing/invoices/")).toHaveLength(gets);
  });

  it("2. recovers the real repeat answer after PayPal created the batch but its answer was lost", async () => {
    const w = await claimed(true);
    const batchId = [...w.sb.payouts.keys()][0];
    const index = vi.spyOn(w.hub, "index");
    const older = olderApp(w);
    w.sb.failNextPayoutRead(503, "SERVICE_UNAVAILABLE", 3);
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "paying", sendTries: 2 });
    expect((await readPot(w)).payoutBatchId).toBeUndefined();
    expect(older.calls("GET /v1/payments/payouts/")).toHaveLength(0);
    advance(w);
    w.sb.repeatNextPayout(batchId, true);
    await recoverPayout(w.ctx, await readPot(w));
    expect(await readPot(w)).toMatchObject({ status: "paid", payoutBatchId: batchId });
    expect(w.sb.payouts.size).toBe(1);
    expect(payoutIds(w)).toEqual(Array(3).fill({ senderBatchId: w.pot.senderBatchId, requestId: w.pot.requestId }));
    expect(index).toHaveBeenCalledWith("batch", batchId, w.ctx.circleId);
    expect(w.sb.calls(`GET /v1/payments/payouts/${batchId}`).length).toBeGreaterThanOrEqual(2);
    expect(older.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("3. keeps a 503 visible as retrying and succeeds after sixty seconds with the same identifiers", async () => {
    const w = await claimed();
    w.sb.failNextPayout(503, "SERVICE_UNAVAILABLE", 3);
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "paying", sendTries: 2 });
    const state = await stateFor(w.ctx, await w.load(), { role: "organiser" }, {});
    expect((state.rounds as any[])[0].pot).toMatchObject({ retrying: true });
    advance(w);
    await recoverPayout(w.ctx, await readPot(w));
    await refreshPot(w.ctx, await readPot(w));
    expect(await readPot(w)).toMatchObject({ status: "paid" });
    expect(w.sb.payouts.size).toBe(1);
    expect(payoutIds(w)).toEqual(Array(4).fill({ senderBatchId: w.pot.senderBatchId, requestId: w.pot.requestId }));
  });

  it("4. stops after MAX_SEND_TRIES unanswered sends and lets a person retry with the same identifiers", async () => {
    const w = await claimed();
    expect(MAX_SEND_TRIES).toBe(12);
    w.sb.failNextPayout(503, "SERVICE_UNAVAILABLE", 3 * (MAX_SEND_TRIES - 1));
    for (let n = 1; n < MAX_SEND_TRIES; n++) {
      await recoverPayout(w.ctx, await readPot(w));
      advance(w);
    }
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "PAYPAL_NOT_ANSWERING", sendTries: MAX_SEND_TRIES });
    const posts = payoutIds(w).length;
    await recoverPayout(w.ctx, await readPot(w));
    expect(payoutIds(w)).toHaveLength(posts);
    expect(await retryPayout(w.ctx, 1)).toMatchObject({ ok: true, paidOut: true });
    expect(await readPot(w)).toMatchObject({ sendTries: 1 });
    await refreshPot(w.ctx, await readPot(w));
    expect(await readPot(w)).toMatchObject({ status: "paid" });
    expect(w.sb.payouts.size).toBe(1);
    expect(payoutIds(w)).toEqual(Array(posts + 1).fill({ senderBatchId: w.pot.senderBatchId, requestId: w.pot.requestId }));
  });

  it("5. fails a recovery on a clear INSUFFICIENT_FUNDS refusal", async () => {
    const w = await claimed();
    w.sb.failNextPayout(422, "INSUFFICIENT_FUNDS");
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "INSUFFICIENT_FUNDS" });
    expect(w.sb.payouts.size).toBe(0);
    expect(payoutIds(w)).toHaveLength(1);
  });

  it("6. blocks recovery and a person's retry of an unmarked older claim without posting on either app", async () => {
    const w = await claimed();
    const older = olderApp(w);
    delete w.pot.sentBy;
    await w.store.put(keys.pot(1), w.pot);
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "CHECK_BY_HAND" });
    expect(await retryPayout(w.ctx, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/check the PayPal account/i) });
    expect(await confirmRelease(w.ctx, 1, "theo")).toMatchObject({ ok: false, error: expect.stringMatching(/check the PayPal account/i) });
    expect(payoutIds(w)).toHaveLength(0);
    expect(older.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("7. refuses a person's retry of older uncertain failures but permits a clear refusal", async () => {
    const w = await claimed();
    const older = olderApp(w);
    delete w.pot.sentBy;
    w.pot.status = "failed";
    for (const refusal of ["HTTP_503", "HTTP_0", "HTTP_500", "NO_CONNECTION", "SERVICE_UNAVAILABLE", "INTERNAL_SERVER_ERROR"]) {
      await w.store.put(keys.pot(1), { ...w.pot, refusal });
      expect(await retryPayout(w.ctx, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/check the PayPal account/i) });
      expect(await confirmRelease(w.ctx, 1, "theo")).toMatchObject({ ok: false, error: expect.stringMatching(/check the PayPal account/i) });
    }
    expect(payoutIds(w)).toHaveLength(0);
    expect(older.calls("POST /v1/payments/payouts")).toHaveLength(0);
    await w.store.put(keys.pot(1), { ...w.pot, refusal: "INSUFFICIENT_FUNDS", sendTries: 12 });
    expect(await retryPayout(w.ctx, 1)).toMatchObject({ ok: true, paidOut: true });
    expect(await readPot(w)).toMatchObject({ sentBy: "main", sendTries: 1 });
    expect(w.sb.payouts.size).toBe(1);
    expect(older.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("8. reconciles a known older batch through the older app without posting on either app", async () => {
    const w = await claimed();
    const older = olderApp(w);
    const batchId = "OLDERBATCH";
    older.payouts.set(batchId, { id: batchId, senderBatchId: w.pot.senderBatchId, cents: w.pot.cents, receiver: "planted", polls: 0 });
    delete w.pot.sentBy;
    w.pot.payoutBatchId = batchId;
    const { stub } = await durableClaim(w, "stuckolder01");
    await runInDurableObject(stub, async (instance: any, state: DurableObjectState) => {
      const ctx = { ...w.ctx, store: state.storage };
      await recoverPayout(ctx, (await state.storage.get<Pot>(keys.pot(1)))!);
      await instance.reconcile(ctx, await w.load());
      expect(await state.storage.get(keys.pot(1))).toMatchObject({ status: "paid", payoutBatchId: batchId });
    });
    expect(older.calls(`GET /v1/payments/payouts/${batchId}`)).toHaveLength(1);
    expect(payoutIds(w)).toHaveLength(0);
    expect(older.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("9. makes no second POST inside the sixty second wait", async () => {
    const w = await claimed();
    w.sb.failNextPayout(503, "SERVICE_UNAVAILABLE", 3);
    await recoverPayout(w.ctx, w.pot);
    expect(RESEND_AFTER_MS).toBe(60_000);
    for (const ms of [20_000, 20_000, 19_999]) {
      advance(w, ms);
      await recoverPayout(w.ctx, await readPot(w));
      expect(payoutIds(w)).toHaveLength(3);
      expect(await readPot(w)).toMatchObject({ sendTries: 2 });
    }
    advance(w, 1);
    await recoverPayout(w.ctx, await readPot(w));
    expect(payoutIds(w)).toHaveLength(4);
  });

  it("10. refuses a repeat naming a batch with another sender id", async () => {
    const w = await claimed();
    const batchId = "WRONGBATCH";
    w.sb.payouts.set(batchId, { id: batchId, senderBatchId: "another-sender", cents: w.pot.cents, receiver: "planted", polls: 0 });
    w.sb.repeatNextPayout(batchId);
    const index = vi.spyOn(w.hub, "index");
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "CHECK_BY_HAND" });
    expect((await readPot(w)).payoutBatchId).toBeUndefined();
    expect(w.sb.calls(`GET /v1/payments/payouts/${batchId}`)).toHaveLength(1);
    expect(index).not.toHaveBeenCalledWith("batch", batchId, w.ctx.circleId);
  });

  it("11. refuses a repeat without a link", async () => {
    const w = await claimed();
    w.sb.repeatNextPayout();
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "CHECK_BY_HAND" });
    expect((await readPot(w)).payoutBatchId).toBeUndefined();
    expect(w.sb.calls("GET /v1/payments/payouts/")).toHaveLength(0);
    const body = { name: "USER_BUSINESS_ERROR", details: [{ field: "SENDER_BATCH_ID", link: [] }], links: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/ORIGINAL" }] };
    expect(originalPayoutBatchId({ status: 400, body, errorName: "USER_BUSINESS_ERROR: extra detail" })).toBe("ORIGINAL");
    expect(originalPayoutBatchId({ status: 422, body })).toBeUndefined();
    expect(originalPayoutBatchId({ status: 400, body: { ...body, name: "OTHER" } })).toBeUndefined();
    expect(originalPayoutBatchId({ status: 400, body: { ...body, details: [{ field: "OTHER" }] } })).toBeUndefined();
  });

  it("12. recovers an idle circle through the Durable Object and the five minute cron", async () => {
    const w = await claimed();
    const { c, stub } = await durableClaim(w, "stuckcron01");
    const hub = env.HUB.get(env.HUB.idFromName("hub"));
    await hub.registerCircle(c.id, false);
    try {
      const execution = createExecutionContext();
      await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() } as ScheduledController, env, execution);
      await waitOnExecutionContext(execution);
      await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
        expect(await state.storage.get(keys.pot(1))).toMatchObject({ status: "paid", payoutBatchId: [...w.sb.payouts.keys()][0] });
        expect(await state.storage.get("lastActivity")).toBe(0);
      });
      expect(w.sb.payouts.size).toBe(1);
      expect(payoutIds(w)).toEqual([{ senderBatchId: w.pot.senderBatchId, requestId: w.pot.requestId }]);
      expect(await hub.lookup("batch", [...w.sb.payouts.keys()][0])).toBe(c.id);
    } finally {
      await hub.forgetCircle(c.id);
    }
  });

  it("13. stops after MAX_SEND_TRIES throwing sends without rejecting recovery", async () => {
    const w = await claimed();
    const logs = (await w.store.list({ prefix: "log:" })).size;
    const send = vi.spyOn(w.ctx.pp, "request").mockRejectedValue(new Error("PayPal token 401"));
    for (let n = 0; n < MAX_SEND_TRIES; n++) {
      await expect(recoverPayout(w.ctx, await readPot(w))).resolves.toBeUndefined();
      advance(w);
    }
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "PAYPAL_NOT_ANSWERING", sendTries: MAX_SEND_TRIES });
    expect(send).toHaveBeenCalledTimes(MAX_SEND_TRIES - 1);
    const added = [...(await w.store.list<{ kind: string; note: string }>({ prefix: "log:" })).values()].slice(logs);
    expect(added.map((entry) => ({ kind: entry.kind, note: entry.note }))).toEqual(
      Array(MAX_SEND_TRIES - 1).fill({ kind: "rule", note: "PayPal payout send threw during recovery" }),
    );
  });

  it("14. requires a manual check when a repeat batch cannot be read up to the send limit", async () => {
    const w = await claimed(true);
    w.sb.failNextPayoutRead(503, "SERVICE_UNAVAILABLE", 3 * (MAX_SEND_TRIES - 1));
    for (let n = 1; n < MAX_SEND_TRIES; n++) {
      await recoverPayout(w.ctx, await readPot(w));
      advance(w);
    }
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "CHECK_BY_HAND", sendTries: MAX_SEND_TRIES });
    expect((await readPot(w)).payoutBatchId).toBeUndefined();
    expect(w.sb.payouts.size).toBe(1);
    expect(await retryPayout(w.ctx, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/check the PayPal account/i) });
    expect(payoutIds(w)).toHaveLength(MAX_SEND_TRIES);
  });

  it("15. reports a daily cap refusal during recovery and lets a person retry later", async () => {
    const w = await claimed();
    w.ctx.pp.beforeWrite = vi.fn(async () => false);
    await recoverPayout(w.ctx, w.pot);
    expect(await readPot(w)).toMatchObject({ status: "failed", refusal: "CK_DAILY_CAP" });
    expect(payoutIds(w)).toHaveLength(0);
    expect(w.sb.payouts.size).toBe(0);
    w.ctx.pp.beforeWrite = vi.fn(async () => true);
    expect(await retryPayout(w.ctx, 1)).toMatchObject({ ok: true, paidOut: true });
    await refreshPot(w.ctx, await readPot(w));
    expect(await readPot(w)).toMatchObject({ status: "paid" });
    expect(payoutIds(w)).toHaveLength(1);
    expect(w.sb.payouts.size).toBe(1);
  });

  it("16. shows retrying for a first send only after sixty seconds", async () => {
    const w = await claimed();
    w.pot.lastSendAt = w.ctx.now().toISOString();
    await w.store.put(keys.pot(1), w.pot);
    const first = await stateFor(w.ctx, await w.load(), { role: "organiser" }, {});
    expect((first.rounds as any[])[0].pot).toMatchObject({ retrying: false });
    advance(w);
    const later = await stateFor(w.ctx, await w.load(), { role: "organiser" }, {});
    expect((later.rounds as any[])[0].pot).toMatchObject({ retrying: true });
  });
});
