import { expect, it } from "vitest";
import { startCircle, getShare, payShareByTestCard, retryPendingRecords } from "../../src/circle/shares";
import { proposeSplit, consentSplit } from "../../src/circle/split";
import { memberActionsFor } from "../../public/js/member-actions.js";
import { stateFor } from "../../src/circle/state";
import { world } from "../helpers/world";

for (const path of ["proposal", "consent", "button"] as const) {
  it(`protects a captured share at split ${path} and reconciles the original invoice`, async () => {
    const w = await world();
    await startCircle(w.ctx);
    const proposal = path === "consent" ? await proposeSplit(w.ctx, 1, "sam", 6000) : undefined;
    w.ctx.pp.beforeWrite = async (_method, url) => !url.endsWith("/payments");
    expect(await payShareByTestCard(w.ctx, 1, "sam")).toMatchObject({ ok: true, pending: true });
    const before = (await getShare(w.ctx, 1, "sam"))!.parts[0];
    if (path === "proposal") expect((await proposeSplit(w.ctx, 1, "sam", 6000)).ok).toBe(false);
    if (path === "consent") expect((await consentSplit(w.ctx, proposal!.split!.id, "sam", "yes")).ok).toBe(false);
    if (path === "button") {
      const state = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "sam" }, {});
      expect(memberActionsFor(state, { id: "sam" }).split).toBe(false);
    }
    expect((await getShare(w.ctx, 1, "sam"))!.parts).toEqual([before]);
    expect(w.sb.invoices.size).toBe(6);
    expect(w.sb.invoices.get(before.invoiceId!)!.status).toBe("SENT");
    w.ctx.pp.beforeWrite = async () => true;
    await retryPendingRecords(w.ctx);
    expect((await getShare(w.ctx, 1, "sam"))!.parts[0]).toMatchObject({ invoiceId: before.invoiceId, captureId: before.captureId, status: "MARKED_AS_PAID" });
    expect(w.sb.orders.size).toBe(1);
  });
}
