import { describe, expect, it } from "vitest";
import { payShareByTestCard, startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

// The payment note shows on PayPal's invoice page, so it names no sandbox (owner's real money rule, 9 Nov).
describe("card payment note", () => {
  it("records the card order without the word sandbox", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const paid = await payShareByTestCard(w.ctx, 1, "sam");
    expect(paid.ok).toBe(true);
    const payment = w.sb.calls("POST /v2/invoicing/invoices/").find((call) => call.path.endsWith("/payments"));
    expect(payment?.body.note).toMatch(/^card order /);
    expect(JSON.stringify(payment?.body)).not.toMatch(/sandbox/i);
  });
});
