import { describe, expect, it } from "vitest";
import { startCircle, getShare, payShareByTestCard } from "../../src/circle/shares";
import { world } from "../helpers/world";

describe("a share paid with the sandbox test card", () => {
  it("captures real sandbox money, then marks the invoice paid by card", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const r = await payShareByTestCard(w.ctx, 1, "dana");
    expect(r.ok).toBe(true);
    const order = [...w.sb.orders.values()][0];
    expect(order.status).toBe("COMPLETED");
    expect(order.cents).toBe(10000);
    const s = (await getShare(w.ctx, 1, "dana"))!;
    expect(s.parts[0].status).toBe("MARKED_AS_PAID");
    expect(s.parts[0].paymentMethod).toBe("CARD");
    const pay = w.sb.calls("POST /v2/invoicing/invoices/").find((c) => c.path.endsWith("/payments"))!;
    expect(pay.body.method).toBe("CREDIT_CARD");
  });

  it("is refused outside the PayPal sandbox", async () => {
    const w = await world();
    await startCircle(w.ctx);
    (w.ctx.pp as any).base = "https://api-m.paypal.com";
    const r = await payShareByTestCard(w.ctx, 1, "dana");
    expect(r.ok).toBe(false);
  });

  it("a paid share is not charged again", async () => {
    const w = await world();
    await startCircle(w.ctx);
    await payShareByTestCard(w.ctx, 1, "dana");
    const again = await payShareByTestCard(w.ctx, 1, "dana");
    expect(again.ok).toBe(false);
    expect(w.sb.orders.size).toBe(1);
  });

  // Seen live on 9 Nov 2026: the sandbox's create answer for a card order carried custom_id on the capture, not the unit.
  function tagOnCaptureOnly(w: any, tag?: string) {
    const original = w.ctx.pp.request.bind(w.ctx.pp);
    w.ctx.pp.request = async (...args: Parameters<typeof original>) => {
      const result = await original(...args);
      const unit = result.body?.purchase_units?.[0];
      const cap = unit?.payments?.captures?.[0];
      if (cap) { cap.custom_id = tag ?? unit.custom_id; delete unit.custom_id; }
      return result;
    };
  }

  it("pays when PayPal puts the part number on the capture instead of the unit", async () => {
    const w = await world();
    await startCircle(w.ctx);
    tagOnCaptureOnly(w);
    const r = await payShareByTestCard(w.ctx, 1, "dana");
    expect(r.ok).toBe(true);
    expect((await getShare(w.ctx, 1, "dana"))!.parts[0].status).toBe("MARKED_AS_PAID");
  });

  it("refuses a capture whose part number names another invoice", async () => {
    const w = await world();
    await startCircle(w.ctx);
    tagOnCaptureOnly(w, "another invoice");
    const r = await payShareByTestCard(w.ctx, 1, "dana");
    expect(r.ok).toBe(false);
    expect((await getShare(w.ctx, 1, "dana"))!.parts[0].status).not.toBe("MARKED_AS_PAID");
  });
});
