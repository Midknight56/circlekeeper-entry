import { describe, expect, it } from "vitest";
import { DAILY_CAP_TEXT } from "../../src/caps";
import { sendReminder } from "../../src/circle/reminders";
import { getShare, recordCashShare, startCircle, startOrderShare, captureOrderShare, payShareByTestCard } from "../../src/circle/shares";
import { world } from "../helpers/world";

function expectCapText(result: any) {
  expect(result.ok).toBe(false);
  expect(result.error).toBe(DAILY_CAP_TEXT);
  expect(result.error).not.toContain("CK_DAILY_CAP");
  expect(result.error).not.toContain("PayPal refused");
}

describe("daily PayPal cap messages", () => {
  it("cash record", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.ctx.pp.beforeWrite = async () => false;
    expectCapText(await recordCashShare(w.ctx, 1, "sam"));
  });

  it("order creation", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.ctx.pp.beforeWrite = async () => false;
    expectCapText(await startOrderShare(w.ctx, 1, "sam"));
  });

  it("order capture", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const order = await startOrderShare(w.ctx, 1, "sam");
    w.ctx.pp.beforeWrite = async () => false;
    expectCapText(await captureOrderShare(w.ctx, String(order.orderId)));
  });

  it("test card order", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.ctx.pp.beforeWrite = async () => false;
    expectCapText(await payShareByTestCard(w.ctx, 1, "sam"));
  });

  it("invoice mark after card payment", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.ctx.pp.beforeWrite = async (_method, path) => !path.endsWith("/payments");
    const result = await payShareByTestCard(w.ctx, 1, "sam");
    expect(result).toMatchObject({ ok: true, pending: true, note: "Your payment went through. We are still marking your share paid. There is nothing more to pay." });
  });

  it("reminder", async () => {
    const w = await world();
    await startCircle(w.ctx);
    w.ctx.pp.beforeWrite = async () => false;
    expectCapText(await sendReminder(w.ctx, "sam", 1, { tone: "kind", reason: "test", note: "Reminder" }));
  });

  it("keeps a real PayPal cash refusal's existing wording", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const paypal = w.ctx.pp as any;
    const fetchFn = paypal.fetchFn;
    paypal.fetchFn = async (url: string, init: RequestInit) => {
      if (init.method === "POST" && url.includes("/payments")) {
        return new Response(JSON.stringify({ name: "INVALID_REQUEST" }), { status: 400 });
      }
      return fetchFn(url, init);
    };
    const result = await recordCashShare(w.ctx, 1, "sam");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("PayPal refused the cash record (INVALID_REQUEST)");
  });
});
