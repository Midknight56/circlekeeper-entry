import { expect, it } from "vitest";
import * as shares from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { keys } from "../../src/circle/model";
import { stateFor } from "../../src/circle/state";
import { memberActionsFor } from "../../public/js/member-actions.js";
import { world } from "../helpers/world";

for (const stage of ["proposal", "consent"] as const) {
  it(`blocks split ${stage} while an approved checkout remains payable`, async () => {
    const w = await world();
    await shares.startCircle(w.ctx);
    const proposal = stage === "consent" ? await proposeSplit(w.ctx, 1, "sam", 6000) : undefined;
    const order = await shares.startOrderShare(w.ctx, 1, "sam");
    w.sb.approveOrder(String(order.orderId));
    const split = stage === "proposal" ? await proposeSplit(w.ctx, 1, "sam", 6000) : await consentSplit(w.ctx, proposal!.split!.id, "sam", "yes");
    expect(split.ok).toBe(false);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts).toHaveLength(1);
    const state = await stateFor(w.ctx, await w.load(), { role: "member", memberId: "sam" }, {});
    expect(memberActionsFor(state, { id: "sam" }).split).toBe(false);
    expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(true);
    expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
    expect([...w.sb.orders.values()].filter((o) => o.status === "COMPLETED").reduce((sum, o) => sum + o.cents, 0)).toBe(10000);
  });
}

it("rejects a legacy cancelled invoice return before capture", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const order = await shares.startOrderShare(w.ctx, 1, "sam");
  w.sb.approveOrder(String(order.orderId));
  const share = (await shares.getShare(w.ctx, 1, "sam"))!;
  share.parts[0].status = "CANCELLED";
  await w.store.put(keys.share(1, "sam"), share);
  expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(false);
  expect(w.sb.calls(`POST /v2/checkout/orders/${order.orderId}/capture`)).toHaveLength(0);
});

it("resumes one checkout and blocks card and cash alternatives", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const first = await shares.startOrderShare(w.ctx, 1, "sam");
  expect(await shares.startOrderShare(w.ctx, 1, "sam")).toMatchObject({ ok: true, orderId: first.orderId, approveUrl: first.approveUrl });
  expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
  expect((await shares.recordCashShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect(w.sb.orders.size).toBe(1);
});

it("holds a lost create answer instead of offering replacement payments", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    return args[1] === "/v2/checkout/orders" ? { status: 0, body: {}, errorName: "NO_CONNECTION" } as typeof result : result;
  };
  expect((await shares.startOrderShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect((await proposeSplit(w.ctx, 1, "sam", 6000)).ok).toBe(false);
  expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
  expect((await shares.startOrderShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect(w.sb.orders.size).toBe(1);
});

it("reconciles a lost capture answer with a read before recording", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const order = await shares.startOrderShare(w.ctx, 1, "sam");
  w.sb.approveOrder(String(order.orderId));
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  let lose = true;
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (lose && args[1].endsWith("/capture")) { lose = false; return { status: 0, body: {}, errorName: "NO_CONNECTION" } as typeof result; }
    return result;
  };
  await shares.captureOrderShare(w.ctx, String(order.orderId));
  await shares.captureOrderShare(w.ctx, String(order.orderId));
  expect(w.sb.calls(`POST /v2/checkout/orders/${order.orderId}/capture`)).toHaveLength(1);
  expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].status).toBe("MARKED_AS_PAID");
});

it("only allows replacement after a verified void, never a failed read", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const order = await shares.startOrderShare(w.ctx, 1, "sam");
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => args[0] === "GET" && args[1].includes("/checkout/orders/")
    ? { status: 404, body: {}, errorName: "RESOURCE_NOT_FOUND" } as any : original(...args);
  expect((await proposeSplit(w.ctx, 1, "sam", 6000)).ok).toBe(false);
  w.ctx.pp.request = original;
  w.sb.orders.get(String(order.orderId))!.status = "VOIDED";
  const split = await proposeSplit(w.ctx, 1, "sam", 6000);
  expect(split.ok).toBe(true);
  expect((await consentSplit(w.ctx, split.split!.id, "sam", "yes")).ok).toBe(true);
  expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(false);
});

it("closes an order on a readable 404 and allows invoice replacement", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const order = await shares.startOrderShare(w.ctx, 1, "sam");
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => args[0] === "GET" && args[1].includes("/checkout/orders/")
    ? { status: 404, body: { name: "RESOURCE_NOT_FOUND" }, bodyRead: true, errorName: "RESOURCE_NOT_FOUND" } as any : original(...args);

  const share = (await shares.getShare(w.ctx, 1, "sam"))!;
  expect(await shares.checkoutBlocksReplacement(w.ctx, share)).toBe(false);
  expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0]).toMatchObject({ orderId: order.orderId, orderState: "closed" });
  expect(await shares.cancelPart(w.ctx, share, share.parts[0], "replace unavailable checkout")).toBe(true);

  const cashWorld = await world();
  await shares.startCircle(cashWorld.ctx);
  const cashOrder = await shares.startOrderShare(cashWorld.ctx, 1, "sam");
  const cashOriginal = cashWorld.ctx.pp.request.bind(cashWorld.ctx.pp);
  cashWorld.ctx.pp.request = async (...args: Parameters<typeof cashOriginal>) => args[0] === "GET" && args[1].includes("/checkout/orders/")
    ? { status: 404, body: { message: "order not found" }, bodyRead: true } as any : cashOriginal(...args);
  expect((await shares.recordCashShare(cashWorld.ctx, 1, "sam")).ok).toBe(true);
  expect((await shares.getShare(cashWorld.ctx, 1, "sam"))!.parts[0]).toMatchObject({ orderId: cashOrder.orderId, orderState: "closed" });
});

it.each([
  [0, {}, false, "NO_CONNECTION"],
  [500, { name: "INTERNAL_SERVER_ERROR" }, true, "INTERNAL_SERVER_ERROR"],
] as const)("keeps checkout blocked after an uncertain order read (HTTP %s)", async (status, body, bodyRead, errorName) => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const order = await shares.startOrderShare(w.ctx, 1, "sam");
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => args[0] === "GET" && args[1].includes("/checkout/orders/")
    ? { status, body, bodyRead, errorName } as any : original(...args);

  const share = (await shares.getShare(w.ctx, 1, "sam"))!;
  expect(await shares.checkoutBlocksReplacement(w.ctx, share)).toBe(true);
  expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0]).toMatchObject({ orderId: order.orderId, orderState: "unknown" });
  expect((await shares.recordCashShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect(await shares.cancelPart(w.ctx, share, share.parts[0], "must remain blocked")).toBe(false);
});

for (const fault of ["pending", "refunded", "wrong amount", "wrong invoice"] as const) {
  it(`holds an ambiguous capture with ${fault} details`, async () => {
    const w = await world();
    await shares.startCircle(w.ctx);
    const order = await shares.startOrderShare(w.ctx, 1, "sam");
    w.sb.approveOrder(String(order.orderId));
    const original = w.ctx.pp.request.bind(w.ctx.pp);
    w.ctx.pp.request = async (...args: Parameters<typeof original>) => {
      const result = await original(...args);
      if (args[1].includes(`/checkout/orders/${order.orderId}`) && result.body?.status === "COMPLETED") {
        const unit = result.body.purchase_units[0];
        const cap = unit.payments.captures[0];
        if (fault === "pending") cap.status = "PENDING";
        if (fault === "refunded") cap.status = "REFUNDED";
        if (fault === "wrong amount") cap.amount.value = "60.00";
        if (fault === "wrong invoice") unit.custom_id = "another invoice";
      }
      return result;
    };
    expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(false);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0]).toMatchObject({ status: "SENT", orderState: "unknown" });
    expect((await proposeSplit(w.ctx, 1, "sam", 6000)).ok).toBe(false);
    expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
    expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((c) => c.path.endsWith("/payments"))).toHaveLength(0);
    w.ctx.pp.request = original;
    await shares.retryPendingRecords(w.ctx);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].status).toBe("MARKED_AS_PAID");
    expect(w.sb.calls(`POST /v2/checkout/orders/${order.orderId}/capture`)).toHaveLength(1);
  });
}

it("refuses capture when the current invoice cannot be read or is cancelled remotely", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const order = await shares.startOrderShare(w.ctx, 1, "sam");
  w.sb.approveOrder(String(order.orderId));
  const part = (await shares.getShare(w.ctx, 1, "sam"))!.parts[0];
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => args[0] === "GET" && args[1].endsWith(part.invoiceId!)
    ? { status: 503, body: {}, errorName: "SERVICE_UNAVAILABLE" } as any : original(...args);
  expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(false);
  w.ctx.pp.request = original;
  w.sb.invoices.get(part.invoiceId!)!.status = "CANCELLED";
  expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(false);
  expect(w.sb.calls(`POST /v2/checkout/orders/${order.orderId}/capture`)).toHaveLength(0);
});

it("does not replace invoices after a lost cancellation answer", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const proposal = await proposeSplit(w.ctx, 1, "sam", 6000);
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => args[1].endsWith("/cancel")
    ? { status: 0, body: {}, errorName: "NO_CONNECTION" } as any : original(...args);
  expect((await consentSplit(w.ctx, proposal.split!.id, "sam", "yes")).ok).toBe(false);
  expect((await shares.getShare(w.ctx, 1, "sam"))!.parts).toHaveLength(1);
});
