import { describe, expect, it } from "vitest";
import { checkBook } from "../../public/js/book-check.js";
import { buildReceipt, hashReceiptChain } from "../../src/circle/receipt";

describe("browser book check", () => {
  it("checks the displayed chain and reports the round whose line changed", async () => {
    const receipt = await hashReceiptChain([buildReceipt({
      round: 1, payoutBatchId: "BATCH", itemStatus: "SUCCESS", paidOutCents: 10000,
      lines: [{ memberId: "one", parts: [{ invoiceId: "INV", cents: 10000, paid: true, method: "CASH_RECORD" }] }],
    })]);
    expect(await checkBook(receipt)).toEqual({ ok: true });
    const altered = structuredClone(receipt);
    (altered[0].lines[0] as { invoiceId: string }).invoiceId = "CHANGED";
    expect(await checkBook(altered)).toEqual({ ok: false, round: 1 });
  });
});
