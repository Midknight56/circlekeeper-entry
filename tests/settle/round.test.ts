import { describe, expect, it } from "vitest";
import { startCircle, recordCashShare } from "../../src/circle/shares";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { proposeSplit, consentSplit } from "../../src/circle/split";
import { settleRound } from "../../src/circle/settle";
import { world } from "../helpers/world";

const ALL = ["keisha", "marisol", "dana", "theo", "amelie", "sam"];

describe("round settlement", () => {
  it("the settled total equals the sum of the paid shares, split parts included", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const p = await proposeSplit(w.ctx, 1, "marisol", 6000);
    await consentSplit(w.ctx, (p as any).split.id, "marisol", "yes");
    for (const m of ALL) await recordCashShare(w.ctx, 1, m);
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const pot = await w.store.get<any>("pot:01");
    await onPayoutEvent(w.ctx, pot.payoutBatchId);
    const s = await settleRound(w.ctx, 1);
    expect(s.paidCents).toBe(60000);
    expect(s.potCents).toBe(60000);
    expect(s.paidOutCents).toBe(60000);
    expect(s.balanced).toBe(true);
    expect(s.lines.find((l) => l.memberId === "marisol")!.parts).toEqual([6000, 4000]);
    expect(s.lines.find((l) => l.memberId === "marisol")!.partDetails.map((p) => p.method)).toEqual(["CASH_RECORD", "CASH_RECORD"]);
  });

  it("an unpaid share leaves the round unbalanced and names who", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of ALL.slice(0, 5)) await recordCashShare(w.ctx, 1, m);
    const s = await settleRound(w.ctx, 1);
    expect(s.paidCents).toBe(50000);
    expect(s.balanced).toBe(false);
    expect(s.unpaid).toEqual(["sam"]);
  });
});
