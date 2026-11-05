import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmRelease } from "../../src/circle/gate";
import { keys, type Pot } from "../../src/circle/model";
import { localTestPot } from "../../src/paypal/test-pot";
import { startCircle, recordCashShare } from "../../src/circle/shares";
import { world } from "../helpers/world";
import { PayPal } from "../../src/paypal/client";

afterEach(() => { vi.restoreAllMocks(); PayPal.resetMemory(); });

describe("local test payout app", () => {
  it("is disabled when routes are off and refuses incomplete local keys", () => {
    expect(localTestPot({ DEV_ROUTES: "0", LOCAL_POT_CLIENT_ID: "id", LOCAL_POT_CLIENT_SECRET: "secret" })).toBeUndefined();
    expect(localTestPot({ DEV_ROUTES: "1", LOCAL_POT_CLIENT_ID: "id" })).toEqual({ refuse: true });
    expect(localTestPot({ DEV_ROUTES: "1", LOCAL_POT_CLIENT_ID: "id", LOCAL_POT_CLIENT_SECRET: "secret" })).toEqual({ clientId: "id", clientSecret: "secret", sendCents: 100 });
  });

  it("sends one dollar through the local sender and keeps the real pot value", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
    w.ctx.sendPp = new PayPal({ ...(w.ctx.pp as any).env, PAYPAL_CLIENT_ID: "pot-app" }, w.sb.fetchFn, () => w.ctx.now().getTime(), async () => {});
    w.ctx.payoutPp = w.ctx.sendPp;
    w.ctx.sendCents = 100;
    const mainRequest = vi.spyOn(w.ctx.pp, "request");
    const potRequest = vi.spyOn(w.ctx.sendPp, "request");
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const pot = (await w.store.get<Pot>(keys.pot(1)))!;
    expect(w.sb.calls("POST /v1/payments/payouts")[0].body.items[0].amount.value).toBe("1.00");
    expect(potRequest.mock.calls.some(([method, path]) => method === "POST" && path === "/v1/payments/payouts")).toBe(true);
    expect(mainRequest.mock.calls.some(([method, path]) => method === "POST" && path === "/v1/payments/payouts")).toBe(false);
    expect(pot.cents).toBe(60000);
    expect(pot.status).toBe("paying");
  });

  it("uses the main sender and the real amount when local test settings are absent", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
    const mainRequest = vi.spyOn(w.ctx.pp, "request");
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    expect(mainRequest.mock.calls.some(([method, path, body]) => method === "POST" && path === "/v1/payments/payouts" && (body as any).items[0].amount.value === "600.00")).toBe(true);
    expect((await w.store.get<Pot>(keys.pot(1)))?.cents).toBe(60000);
  });

  it("reads a repeated payout answer through the selected sender", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
    const sender = new PayPal({ ...(w.ctx.pp as any).env, PAYPAL_CLIENT_ID: "pot-repeat-app" }, w.sb.fetchFn, () => w.ctx.now().getTime(), async () => {});
    w.ctx.sendPp = sender;
    const read = vi.spyOn(sender, "request");
    const mainRead = vi.spyOn(w.ctx.pp, "request");
    w.sb.repeatNextPayout("BATCH-UNKNOWN");
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    expect(read.mock.calls.some(([method, path]) => method === "GET" && path.startsWith("/v1/payments/payouts/"))).toBe(true);
    expect(mainRead.mock.calls.some(([method, path]) => method === "GET" && path.startsWith("/v1/payments/payouts/"))).toBe(false);
  });

  it("refuses local sends without making a PayPal call", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of w.circle.members) await recordCashShare(w.ctx, 1, m.id);
    w.ctx.noLocalSend = true;
    await confirmRelease(w.ctx, 1, "dana");
    const result = await confirmRelease(w.ctx, 1, "theo");
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await w.store.get<Pot>(keys.pot(1))).toMatchObject({ status: "failed", refusal: "LOCAL_NO_TEST_POT" });
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });
});
