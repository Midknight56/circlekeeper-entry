import { describe, expect, it } from "vitest";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { recordCashShare, startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const ALL = ["keisha", "marisol", "dana", "theo", "amelie", "sam"];

describe("denied payout batches", () => {
  it("fails the pot when PayPal denies its batch without payout items", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const member of ALL) await recordCashShare(w.ctx, 1, member);
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const pot = await w.store.get<any>("pot:01");
    w.sb.denyPayout(pot.payoutBatchId);

    await onPayoutEvent(w.ctx, pot.payoutBatchId);

    const after = await w.store.get<any>("pot:01");
    expect(after.status).toBe("failed");
    expect(after.refusal).toBe("DENIED");
  });
});
