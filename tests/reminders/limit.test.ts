import { describe, expect, it } from "vitest";
import { startCircle, getShare, recordCashShare } from "../../src/circle/shares";
import { sendReminder, dailyReminders } from "../../src/circle/reminders";
import { world } from "../helpers/world";

describe("reminders", () => {
  it("no second reminder within 3 days; a third day later is allowed", async () => {
    const w = await world({ clock: "2026-12-05T15:00:00Z" });
    await startCircle(w.ctx);
    const first = await sendReminder(w.ctx, "dana", 1, { tone: "kind", reason: "due in 5 days", note: "A kind nudge." });
    expect(first.ok).toBe(true);
    w.setNow("2026-12-07T15:00:00Z");
    const second = await sendReminder(w.ctx, "dana", 1, { tone: "kind", reason: "again", note: "Again." });
    expect(second.ok).toBe(false);
    w.setNow("2026-12-08T16:00:00Z");
    const third = await sendReminder(w.ctx, "dana", 1, { tone: "kind", reason: "due in 2 days", note: "Soon." });
    expect(third.ok).toBe(true);
    const remindCalls = w.sb.calls("POST /v2/invoicing/invoices/").filter((s) => s.path.endsWith("/remind"));
    expect(remindCalls).toHaveLength(2);
  });

  it("none after the share is paid", async () => {
    const w = await world({ clock: "2026-12-05T15:00:00Z" });
    await startCircle(w.ctx);
    await recordCashShare(w.ctx, 1, "dana");
    const r = await sendReminder(w.ctx, "dana", 1, { tone: "kind", reason: "x", note: "x" });
    expect(r.ok).toBe(false);
  });

  it("the stored reminder keeps its reason", async () => {
    const w = await world({ clock: "2026-12-05T15:00:00Z" });
    await startCircle(w.ctx);
    await sendReminder(w.ctx, "theo", 1, { tone: "gentle", reason: "due on the 10th, nothing paid yet", note: "Hi Theo." });
    const s = (await getShare(w.ctx, 1, "theo"))!;
    expect(s.reminders[0]).toMatchObject({ reason: "due on the 10th, nothing paid yet", tone: "gentle", sent: true });
  });

  it("the daily pass reminds only unpaid shares due within 3 days, once", async () => {
    const w = await world({ clock: "2026-12-08T13:00:00Z" }); // round 1 shares are due 2026-12-10
    await startCircle(w.ctx);
    await recordCashShare(w.ctx, 1, "keisha");
    const n = await dailyReminders(w.ctx);
    expect(n).toBe(5);
    const again = await dailyReminders(w.ctx);
    expect(again).toBe(0);
  });
});
