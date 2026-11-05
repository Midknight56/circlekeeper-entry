import { expect, it } from "vitest";
import { confirmRelease } from "../../src/circle/gate";
import { consentMissed, proposeMissed } from "../../src/circle/missed";
import { dayName } from "../../src/circle/messages";
import { maybeDraftPot, refreshShare, sharesOfRound, startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

it("holds a protected turn until the agreed date even with both confirmations", async () => {
  const w = await world();
  await startCircle(w.ctx);
  w.setNow("2026-12-20T12:00:00Z");
  const proposal = await proposeMissed(w.ctx, 1, "keisha");
  const missed = (proposal as any).missed;
  expect(missed.action).toBe("pot_waits");
  expect(missed.plan.waitUntil).toBe("2026-12-23");
  await consentMissed(w.ctx, missed.id, "dana", "yes");
  await consentMissed(w.ctx, missed.id, "theo", "yes");
  for (const share of await sharesOfRound(w.ctx, 1)) {
    w.sb.payInvoice(share.parts[0].invoiceId!);
    await refreshShare(w.ctx, share);
  }
  await maybeDraftPot(w.ctx, 1);
  await confirmRelease(w.ctx, 1, "dana");
  expect(await confirmRelease(w.ctx, 1, "theo")).toEqual({ ok: false, error: `the circle agreed to wait until ${dayName("2026-12-23", "en")}; the pot can go then` });
  expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  expect((await w.store.get<any>("pot:01")).confirmations).toHaveLength(2);
  expect([...(await w.store.list<any>({ prefix: "log:" })).values()].some((l) => l.note === "payout held: the circle agreed to wait until 2026-12-23")).toBe(true);
  w.setNow("2026-12-23T12:00:00Z");
  expect(await confirmRelease(w.ctx, 1, "theo")).toMatchObject({ ok: true, paidOut: true });
  expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(1);
});
