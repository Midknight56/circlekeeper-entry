import { expect, it } from "vitest";
import * as shares from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { keys } from "../../src/circle/model";
import { world } from "../helpers/world";

async function splitWorld() {
  const w = await world();
  await shares.startCircle(w.ctx);
  const proposal = await proposeSplit(w.ctx, 1, "sam", 6000);
  expect((await consentSplit(w.ctx, proposal.split!.id, "sam", "yes")).ok).toBe(true);
  return w;
}

for (const action of ["cash", "cancel"] as const) {
  it(`allows ${action} on the unpaid split part after checkout paid the first part`, async () => {
    const w = await splitWorld();
    const first = (await shares.getShare(w.ctx, 1, "sam"))!.parts[1];
    const order = await shares.startOrderShare(w.ctx, 1, "sam", first.number);
    w.sb.approveOrder(String(order.orderId));
    expect((await shares.captureOrderShare(w.ctx, String(order.orderId))).ok).toBe(true);
    const share = (await shares.getShare(w.ctx, 1, "sam"))!;
    if (action === "cash") {
      expect(await shares.recordCashShare(w.ctx, 1, "sam")).toMatchObject({ ok: true, recorded: 1 });
      expect(w.sb.invoices.get(share.parts[2].invoiceId!)!.status).toBe("MARKED_AS_PAID");
    } else {
      expect(await shares.cancelPart(w.ctx, share, share.parts[2], "replace unpaid part")).toBe(true);
      expect(w.sb.invoices.get(share.parts[2].invoiceId!)!.status).toBe("CANCELLED");
    }
    expect(w.sb.calls(`POST /v2/checkout/orders/${order.orderId}/capture`)).toHaveLength(1);
    expect(w.sb.invoices.get(first.invoiceId!)!.status).toBe("MARKED_AS_PAID");
  });
}

it("does not hold paid or recorded captures, but still holds captures waiting to be recorded", async () => {
  const w = await splitWorld();
  const share = (await shares.getShare(w.ctx, 1, "sam"))!;
  const part = share.parts[1];
  part.orderId = "old-order";
  part.orderState = "unknown";
  part.status = "PAID";
  expect(shares.checkoutPending(part)).toBe(false);
  part.recordPending = true;
  expect(shares.checkoutPending(part)).toBe(false);
  delete part.recordPending;
  part.status = "SENT";
  part.orderState = "captured";
  expect(shares.checkoutPending(part)).toBe(false);
  part.recordPending = true;
  await w.store.put(keys.share(1, "sam"), share);
  expect(shares.checkoutPending(part)).toBe(true);
  expect(await shares.checkoutBlocksReplacement(w.ctx, share)).toBe(true);
  expect((await shares.recordCashShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect(await shares.cancelPart(w.ctx, share, share.parts[2], "replace unpaid part")).toBe(false);
});

it("does not offer a recorded capture again when the invoice read is stale", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(true);
  const share = (await shares.getShare(w.ctx, 1, "sam"))!;
  share.parts[0].status = "SENT";
  await w.store.put(keys.share(1, "sam"), share);
  const original = w.ctx.pp.request.bind(w.ctx.pp);
  w.ctx.pp.request = async (...args: Parameters<typeof original>) => args[0] === "GET" && args[1].endsWith(share.parts[0].invoiceId!)
    ? { status: 503, body: {}, errorName: "SERVICE_UNAVAILABLE" } as any : original(...args);
  expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
  expect((await shares.startOrderShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect((await shares.recordCashShare(w.ctx, 1, "sam")).ok).toBe(false);
  expect(w.sb.orders.size).toBe(1);
  expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((c) => c.path.endsWith("/payments"))).toHaveLength(1);
});

for (const method of ["card", "paypal"] as const) {
  const pay = method === "card" ? shares.payShareByTestCard : shares.startOrderShare;
  for (const status of [400, 401, 403, 404, 422]) {
    it(`releases a readable first ${status} refusal for ${method} and uses a new request id`, async () => {
      const w = await world();
      await shares.startCircle(w.ctx);
      const fetch = (w.ctx.pp as any).fetchFn as typeof globalThis.fetch;
      const refusedIds: string[] = [];
      let refuse = true;
      (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (refuse && new URL(String(input)).pathname === "/v2/checkout/orders") {
          refusedIds.push(new Headers(init?.headers).get("paypal-request-id")!);
          return Response.json({ name: "ORDER_REFUSED" }, { status });
        }
        return fetch(input, init);
      };
      expect((await pay(w.ctx, 1, "sam")).ok).toBe(false);
      expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].orderState).toBeUndefined();
      refuse = false;
      expect((await pay(w.ctx, 1, "sam")).ok).toBe(true);
      const created = w.sb.calls("POST /v2/checkout/orders");
      expect(created).toHaveLength(1);
      expect(refusedIds).not.toContain(created[0].headers["paypal-request-id"]);
    });
  }

  it(`replays the exact persisted ${method} request after a lost response, even through the other pay entry point`, async () => {
    const w = await world();
    await shares.startCircle(w.ctx);
    const fetch = (w.ctx.pp as any).fetchFn as typeof globalThis.fetch;
    const sent: { id: string; body: string }[] = [];
    let answer: Response | undefined;
    let lose = true;
    (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname !== "/v2/checkout/orders") return fetch(input, init);
      const request = { id: new Headers(init?.headers).get("paypal-request-id")!, body: String(init?.body) };
      // Intent, full body and id must be durable before the first network send.
      const saved = (await shares.getShare(w.ctx, 1, "sam"))!.parts[0] as any;
      expect(saved.orderRequest).toMatchObject({ id: request.id, body: request.body });
      sent.push(request);
      answer ||= await fetch(input, init);
      if (lose) throw new Error("answer lost after order creation");
      expect(request).toEqual(sent[0]);
      return answer.clone();
    };
    expect((await pay(w.ctx, 1, "sam")).ok).toBe(false);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].orderState).toBe("unknown");
    expect((await shares.recordCashShare(w.ctx, 1, "sam")).ok).toBe(false);
    const sentBeforeReplay = sent.length;
    w.ctx.baseUrl = "https://changed.test";
    lose = false;
    const retry = method === "card" ? shares.startOrderShare : shares.payShareByTestCard;
    const result = await retry(w.ctx, 1, "sam");
    expect(result.ok).toBe(true);
    expect(sent.length).toBeGreaterThan(sentBeforeReplay);
    expect(sent.every((request) => request.id === sent[0].id && request.body === sent[0].body)).toBe(true);
    expect(w.sb.orders.size).toBe(1);
    if (method === "card") {
      expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].status).toBe("MARKED_AS_PAID");
      expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((c) => c.path.endsWith("/payments"))).toHaveLength(1);
    } else expect(result.orderId).toBe([...w.sb.orders.keys()][0]);
  });
}

for (const fault of ["network", "stream", "invalid JSON", "409", "429", "503"] as const) {
  it(`keeps ${fault} pending and replays its original request even after a readable replay refusal`, async () => {
    const w = await world();
    await shares.startCircle(w.ctx);
    const fetch = (w.ctx.pp as any).fetchFn as typeof globalThis.fetch;
    const sent: { id: string; body: string }[] = [];
    let phase = "uncertain";
    (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname !== "/v2/checkout/orders") return fetch(input, init);
      sent.push({ id: new Headers(init?.headers).get("paypal-request-id")!, body: String(init?.body) });
      if (phase === "refusal") return Response.json({ name: "ORDER_REFUSED" }, { status: 422 });
      if (phase === "success") return fetch(input, init);
      if (fault === "network") throw new Error("offline");
      if (fault === "stream") return new Response(new ReadableStream({ start(c) { c.error(new Error("unreadable")); } }), { status: 422 });
      if (fault === "invalid JSON") return new Response("unreadable JSON", { status: 422 });
      return Response.json({ name: "UNCERTAIN" }, { status: Number(fault) });
    };
    expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].orderState).toBe("unknown");
    const before = sent.length;
    phase = "refusal";
    expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
    expect(sent.length).toBeGreaterThan(before);
    expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].orderState).toBe("unknown");
    phase = "success";
    expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(true);
    expect(sent.every((request) => request.id === sent[0].id && request.body === sent[0].body)).toBe(true);
    expect(w.sb.orders.size).toBe(1);
  });
}

it("does not release a readable refusal after an earlier uncertain automatic send", async () => {
  const w = await world();
  await shares.startCircle(w.ctx);
  const fetch = (w.ctx.pp as any).fetchFn as typeof globalThis.fetch;
  const ids: string[] = [];
  let succeed = false;
  (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname !== "/v2/checkout/orders") return fetch(input, init);
    ids.push(new Headers(init?.headers).get("paypal-request-id")!);
    if (succeed) return fetch(input, init);
    if (ids.length === 1) throw new Error("answer lost");
    return Response.json({ name: "ORDER_REFUSED" }, { status: 422 });
  };
  expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(false);
  expect((await shares.getShare(w.ctx, 1, "sam"))!.parts[0].orderState).toBe("unknown");
  succeed = true;
  expect((await shares.payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(true);
  expect(new Set(ids).size).toBe(1);
});
