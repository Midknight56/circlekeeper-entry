import { describe, expect, it } from "vitest";
import { buildReceipt, hashReceiptChain } from "../../src/circle/receipt";

const source = {
  round: 1,
  payoutBatchId: "BATCH-1",
  itemStatus: "SUCCESS",
  paidOutCents: 20000,
  lines: [
    { memberId: "a", parts: [{ invoiceId: "INV-A", cents: 10000, paid: true, method: "CASH_RECORD" }] },
    { memberId: "b", parts: [{ invoiceId: "INV-B1", cents: 6000, paid: true, method: "PAYPAL" }, { invoiceId: "INV-B2", cents: 4000, paid: true, method: "CARD" }] },
  ],
};

describe("round receipt", () => {
  it("balances a full share round and a short share split", () => {
    expect(buildReceipt({ ...source, lines: [source.lines[0], { memberId: "b", parts: [{ invoiceId: "INV-B", cents: 10000, paid: true, method: "PAYPAL" }] }] }).deltaCents).toBe(0);
    const receipt = buildReceipt(source);
    expect(receipt.deltaCents).toBe(0);
    expect(receipt.lines.filter((line) => line.kind === "share").map((line) => line.cents)).toEqual([10000, 6000, 4000]);
  });

  it("flags a non zero delta with a reason", () => {
    const receipt = buildReceipt({ ...source, paidOutCents: 19000 });
    expect(receipt.deltaCents).toBe(1000);
    expect(receipt.deltaReason).toMatch(/do not match/i);
  });

  it("hashes stable fixed lines and changes when any line changes", async () => {
    const receipt = buildReceipt(source);
    const one = await hashReceiptChain([receipt]);
    const same = await hashReceiptChain([receipt]);
    const changed = await hashReceiptChain([buildReceipt({ ...source, paidOutCents: 59999 })]);
    expect(one).toEqual(same);
    expect(one[0].hash).not.toBe(changed[0].hash);
  });
});
