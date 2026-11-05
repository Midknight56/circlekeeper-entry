import { describe, expect, it } from "vitest";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { startCircle, recordCashShare } from "../../src/circle/shares";
import { stateFor, viewerFor } from "../../src/circle/state";
import { world } from "../helpers/world";

const ALL = ["keisha", "marisol", "dana", "theo", "amelie", "sam"];

describe("receipt access", () => {
  it("lets a member key read the round receipt and rejects a wrong key", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const member of ALL) await recordCashShare(w.ctx, 1, member);
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const pot = await w.store.get<any>("pot:01");
    await onPayoutEvent(w.ctx, pot.payoutBatchId);
    const c = await w.load();
    const viewer = viewerFor(c, c.members[0].token);
    expect(viewer).toEqual({ role: "member", memberId: "keisha" });
    const memberState = await stateFor(w.ctx, c, viewer!, {});
    expect((memberState.receipts as any[])).toHaveLength(1);
    expect((memberState.receipts as any[])[0].deltaCents).toBe(0);
    expect(viewerFor(c, "wrong-key")).toBeNull();
  });
});
