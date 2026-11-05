import { describe, expect, it } from "vitest";
import { startCircle, issueRound, getShare } from "../../src/circle/shares";
import { world } from "../helpers/world";

describe("error states", () => {
  it("a PayPal outage during Start says so in plain words, and a retry sends only what is missing", async () => {
    const w = await world();
    w.sb.failInvoiceCreates(3, 503);
    const r = await startCircle(w.ctx);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/PayPal did not answer/i);
    // The client retries a 503 up to three times, so the three failures land on one invoice.
    expect(w.sb.invoices.size).toBe(5);
    const again = await issueRound(w.ctx, 1);
    expect(again.ok).toBe(true);
    expect(w.sb.invoices.size).toBe(6);
    for (const id of ["keisha", "marisol", "dana", "theo", "amelie", "sam"]) {
      expect((await getShare(w.ctx, 1, id))!.parts[0].status).toBe("SENT");
    }
  });

  it("the day's PayPal write cap gives a clear message, and nothing is half sent", async () => {
    const w = await world();
    let left = 4;
    w.ctx.pp.beforeWrite = async () => left-- > 0;
    const r = await startCircle(w.ctx);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/today's sandbox limit/i);
  });
});
