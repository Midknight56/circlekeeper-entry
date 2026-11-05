import { expect, it } from "vitest";
import * as shares from "../../src/circle/shares";
import { shareState } from "../../src/circle/model";
import { stateFor } from "../../src/circle/state";
import { world } from "../helpers/world";

for (const method of ["checkout", "card"] as const) {
  it(`${method} keeps a captured payment when recording is capped and retries only the record`, async () => {
    const w = await world();
    await shares.startCircle(w.ctx);
    for (const m of w.circle.members.filter((m) => m.id !== "sam")) await shares.recordCashShare(w.ctx, 1, m.id);
    w.ctx.pp.beforeWrite = async (_method, path) => !path.endsWith("/payments");
    let result;
    if (method === "checkout") {
      const order = await shares.startOrderShare(w.ctx, 1, "sam");
      w.sb.approveOrder(String(order.orderId));
      result = await shares.captureOrderShare(w.ctx, String(order.orderId));
    } else result = await shares.payShareByTestCard(w.ctx, 1, "sam");
    expect(result).toMatchObject({ ok: true, pending: true, note: "Your payment went through. We are still marking your share paid. There is nothing more to pay." });
    const s = (await shares.getShare(w.ctx, 1, "sam"))!;
    const p = s.parts[0];
    expect(p).toMatchObject({ orderId: [...w.sb.orders.keys()][0], captureId: "CAP" + [...w.sb.orders.keys()][0], capturedCents: 10000, capturedAt: w.ctx.now().toISOString(), recordPending: true });
    expect(shareState(s, 10000)).toBe("sent");
    expect((await w.store.get<any>("pot:01")).status).toBe("waiting");
    const own: any = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "sam" }, {});
    expect(own.rounds[0].shares.find((s: any) => s.memberId === "sam").parts[0].recordPending).toBe(true);
    const other: any = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "dana" }, {});
    const samForOther = other.rounds[0].shares.find((s: any) => s.memberId === "sam");
    expect(samForOther.parts).toBeUndefined();
    expect(JSON.stringify(samForOther)).not.toContain("recordPending");
    expect(await shares.payShareByTestCard(w.ctx, 1, "sam")).toMatchObject({ ok: false, error: "that part is already paid and is being recorded" });
    expect(await shares.startOrderShare(w.ctx, 1, "sam")).toMatchObject({ ok: false, error: "that part is already paid and is being recorded" });
    const captures = w.sb.calls("POST /v2/checkout/orders/").length;
    expect(await shares.captureOrderShare(w.ctx, p.orderId!)).toMatchObject({ ok: true, pending: true });
    expect(w.sb.calls("POST /v2/checkout/orders/")).toHaveLength(captures);
    expect(w.sb.orders.size).toBe(1);
    await shares.retryPendingRecords(w.ctx);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].recordPending).toBe(true);
    w.ctx.pp.beforeWrite = async () => true;
    const pp = w.ctx.pp as any;
    const fetchFn = pp.fetchFn;
    let refusal = 400;
    pp.fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith(`/${p.invoiceId}/payments`)) {
        if (refusal === 0) throw new Error("connection lost");
        return Response.json({ name: "RECORD_REFUSED" }, { status: refusal });
      }
      return fetchFn(input, init);
    };
    for (refusal of [400, 503, 0]) {
      await shares.retryPendingRecords(w.ctx);
      expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].recordPending).toBe(true);
    }
    pp.fetchFn = fetchFn;
    w.setNow("2026-12-02T15:00:00Z");
    await shares.retryPendingRecords(w.ctx);
    await shares.retryPendingRecords(w.ctx);
    const paid = (await shares.getShare(w.ctx, 1, "sam"))!.parts[0];
    expect(paid.recordPending).toBeFalsy();
    expect(paid.status).toBe("MARKED_AS_PAID");
    expect(paid.paymentMethod).toBe(method === "card" ? "CARD" : "PAYPAL");
    expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((c) => c.path === `/v2/invoicing/invoices/${p.invoiceId}/payments`)).toHaveLength(1);
    const record = w.sb.calls("POST /v2/invoicing/invoices/").find((c) => c.path === `/v2/invoicing/invoices/${p.invoiceId}/payments`)!;
    expect(record.headers["paypal-request-id"]).toBe(p.requestId + (method === "card" ? "-cardpay" : "-orderpay"));
    expect(record.body.payment_date).toBe("2026-12-01");
    const log = [...(await w.store.list<any>({ prefix: "log:" })).values()];
    expect(log.some((l) => l.note?.includes(p.number) && l.note.includes("CK_DAILY_CAP"))).toBe(true);
    expect((await w.store.get<any>("pot:01")).status).toBe("drafted");
  });
}
