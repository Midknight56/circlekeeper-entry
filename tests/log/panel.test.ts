import { describe, expect, it } from "vitest";
import { startCircle, recordCashShare } from "../../src/circle/shares";
import { confirmRelease } from "../../src/circle/gate";
import type { LogEntry } from "../../src/circle/model";
import { world } from "../helpers/world";

describe("the tool panel", () => {
  it("each PayPal call logs method, path, code and id, and never a token or an email", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const m of ["keisha", "marisol", "dana", "theo", "amelie", "sam"]) await recordCashShare(w.ctx, 1, m);
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const log = [...(await w.store.list<LogEntry>({ prefix: "log:" })).values()].filter((l) => l.kind === "paypal");
    const calls = w.sb.sent.filter((s) => s.path !== "/v1/oauth2/token");
    expect(log.length).toBe(calls.length);
    for (const l of log) {
      expect(l.method).toMatch(/^(GET|POST)$/);
      expect(l.path).toMatch(/^\/v[12]\//);
      expect(typeof l.status).toBe("number");
    }
    const creates = log.filter((l) => l.method === "POST" && l.path === "/v2/invoicing/invoices");
    expect(creates).toHaveLength(6);
    for (const c of creates) expect(c.ids![0]).toMatch(/^INV2-/);
    const payout = log.find((l) => l.path === "/v1/payments/payouts")!;
    expect(payout.ids![0]).toMatch(/^BATCH/);
    const text = JSON.stringify(log);
    expect(text).not.toMatch(/tok-|Bearer|secret|@test/);
  });
});

describe("background refresh", () => {
  it("a quiet refresh keeps its successful reads out of the panel, but not its errors", async () => {
    const { refreshShare, getShare } = await import("../../src/circle/shares");
    const w = await world();
    await startCircle(w.ctx);
    const before = [...(await w.store.list<LogEntry>({ prefix: "log:" })).values()].length;
    w.ctx.quiet = true;
    await refreshShare(w.ctx, (await getShare(w.ctx, 1, "sam"))!);
    const after = [...(await w.store.list<LogEntry>({ prefix: "log:" })).values()].length;
    expect(after).toBe(before);
  });
});
