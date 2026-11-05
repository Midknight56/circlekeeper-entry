import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { getShare, onInvoiceEvent, payShareByTestCard, startCircle } from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import { confirmRelease, onPayoutEvent } from "../../src/circle/gate";
import { PayPal } from "../../src/paypal/client";
import { sandbox } from "../helpers/sandbox";
import { world } from "../helpers/world";

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

describe("attacks on money coming in", () => {
  it("refuses a second card payment, including when PayPal already says the invoice is paid", async () => {
    const w = await world();
    await startCircle(w.ctx);
    expect((await payShareByTestCard(w.ctx, 1, "dana")).ok).toBe(true);
    const firstOrderCount = w.sb.orders.size;
    const again = await payShareByTestCard(w.ctx, 1, "dana");
    expect(again).toMatchObject({ ok: false, error: "that share is already paid" });
    expect(w.sb.orders.size).toBe(firstOrderCount);

    const invoiceId = (await getShare(w.ctx, 1, "keisha"))!.parts[0].invoiceId!;
    w.sb.payInvoice(invoiceId);
    const externallyPaid = await payShareByTestCard(w.ctx, 1, "keisha");
    expect(externallyPaid).toMatchObject({ ok: false, error: "that share is already paid" });
    expect(w.sb.orders.size).toBe(firstOrderCount);
    expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((c) => c.path.endsWith("/payments"))).toHaveLength(1);
  });

  it("serializes two simultaneous card requests so only one order is captured", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return sb.fetchFn(input as any, init);
    });
    const draft = draftCircle("A savings circle with Keisha, Marisol, Dana, Theo, Amelie and Sam", "2026-10-23");
    expect(draft.circle).toBeTruthy();
    const c = draft.circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
    await stub.create(c);
    await stub.start("https://ck.test", c.organiserToken);
    const requests: Promise<any>[] = [];
    requests.push(stub.card("https://ck.test", c.members[2].token, 1, c.members[2].id));
    requests.push(stub.card("https://ck.test", c.members[2].token, 1, c.members[2].id));
    const results = await Promise.all(requests);
    expect(results.map((r: any) => r.status).sort()).toEqual([200, 409]);
    expect(sb.orders.size).toBe(1);
    expect(sb.calls("POST /v2/checkout/orders")).toHaveLength(1);
  });

  it("ignores a late invoice payment after the pot was paid, without starting another payout", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const id of ["keisha", "marisol", "dana", "theo", "amelie", "sam"]) {
      const share = (await getShare(w.ctx, 1, id))!;
      w.sb.payInvoice(share.parts[0].invoiceId!);
      await onInvoiceEvent(w.ctx, share.parts[0].invoiceId!, "INVOICING.INVOICE.PAID");
    }
    await confirmRelease(w.ctx, 1, "dana");
    expect((await confirmRelease(w.ctx, 1, "theo")).paidOut).toBe(true);
    const pending = (await w.store.get<any>("pot:01"))!;
    await onPayoutEvent(w.ctx, pending.payoutBatchId);
    const before = (await w.store.get<any>("pot:01"))!;
    expect(before.status).toBe("paid");
    const payCalls = w.sb.calls("POST /v1/payments/payouts").length;

    const late = await payShareByTestCard(w.ctx, 1, "sam");
    expect(late).toMatchObject({ ok: false, error: "that share is already paid" });
    const after = (await w.store.get<any>("pot:01"))!;
    expect(after.status).toBe("paid");
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(payCalls);
    expect(w.sb.calls("POST /v2/checkout/orders")).toHaveLength(0);
    expect(w.sb.payouts.size).toBe(1);
  });

  it("refuses payment of a part canceled by a short share split", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const split = await proposeSplit(w.ctx, 1, "marisol", 6000);
    expect(split.ok).toBe(true);
    const oldPart = (await getShare(w.ctx, 1, "marisol"))!.parts[0];
    expect((await consentSplit(w.ctx, (split as any).split.id, "marisol", "yes")).ok).toBe(true);
    const before = w.sb.orders.size;
    const result = await payShareByTestCard(w.ctx, 1, "marisol");
    expect(result.ok).toBe(true);
    expect(w.sb.orders.size).toBe(before + 1);
    expect((await getShare(w.ctx, 1, "marisol"))!.parts[0].status).toBe("CANCELLED");
    expect([...w.sb.orders.values()].every((o) => o.customId !== oldPart.number)).toBe(true);
  });

  it("refuses another member's share and missing or foreign circle keys before any PayPal write", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const one = draftCircle("A savings circle with Keisha, Marisol, Dana, Theo, Amelie and Sam", "2026-10-23").circle!;
    const two = draftCircle("A savings circle with Keisha, Marisol, Dana, Theo, Amelie and Sam", "2026-10-23").circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(one.id));
    await stub.create(one);
    await stub.start("https://ck.test", one.organiserToken);
    const foreignStub = env.CIRCLE.get(env.CIRCLE.idFromName(two.id));
    await foreignStub.create(two);
    const target = one.members[0];
    const attacks = [
      await stub.card("https://ck.test", one.members[1].token, 1, target.id),
      await stub.card("https://ck.test", "", 1, target.id),
      await stub.card("https://ck.test", two.members[0].token, 1, target.id),
    ];
    expect(attacks.map((r: any) => r.status)).toEqual([403, 403, 403]);
    expect(sb.orders.size).toBe(0);
    expect(sb.calls("POST /v2/checkout/orders")).toHaveLength(0);
  });

  it("replaying a completed order capture leaves the share paid once and does not capture twice", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const orderResult = await (await import("../../src/circle/shares")).startOrderShare(w.ctx, 1, "dana");
    expect(orderResult.ok).toBe(true);
    const orderId = (orderResult as any).orderId as string;
    w.sb.approveOrder(orderId);
    const first = await (await import("../../src/circle/shares")).captureOrderShare(w.ctx, orderId);
    expect(first.ok).toBe(true);
    const second = await (await import("../../src/circle/shares")).captureOrderShare(w.ctx, orderId);
    expect(second).toMatchObject({ ok: true, already: true });
    expect(w.sb.calls("POST /v2/checkout/orders/").filter((c) => c.path.endsWith("/capture"))).toHaveLength(1);
    expect(w.sb.calls("POST /v2/invoicing/invoices/").filter((c) => c.path.endsWith("/payments"))).toHaveLength(1);
    expect((await getShare(w.ctx, 1, "dana"))!.parts[0].status).toBe("MARKED_AS_PAID");
  });

  it("replays an uncertain create and retries a capture only after checking the same order", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const originalFetch = (w.ctx.pp as any).fetchFn as typeof fetch;
    let failingPath: string | undefined;
    let failuresLeft = 3;
    (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === failingPath && failuresLeft > 0) {
        failuresLeft--;
        if (path === "/v2/checkout/orders") return Response.json({ name: "SERVICE_UNAVAILABLE" }, { status: 500 });
        throw new Error("timed out");
      }
      return originalFetch(input, init);
    };

    failingPath = "/v2/checkout/orders";
    const orderError = await payShareByTestCard(w.ctx, 1, "dana");
    expect(orderError.ok).toBe(false);
    expect((orderError as any).error).toMatch(/PayPal refused the card payment/i);
    expect((await getShare(w.ctx, 1, "dana"))!.parts[0].status).toBe("SENT");
    expect(w.sb.orders.size).toBe(0);
    failuresLeft = 0;
    expect((await payShareByTestCard(w.ctx, 1, "dana")).ok).toBe(true);
    expect(w.sb.orders.size).toBe(1);
    expect((await getShare(w.ctx, 1, "dana"))!.parts[0].status).toBe("MARKED_AS_PAID");

    const approved = await (await import("../../src/circle/shares")).startOrderShare(w.ctx, 1, "keisha");
    expect(approved.ok).toBe(true);
    const orderId = (approved as any).orderId as string;
    w.sb.approveOrder(orderId);
    failingPath = `/v2/checkout/orders/${orderId}/capture`;
    failuresLeft = 3;
    const captureError = await (await import("../../src/circle/shares")).captureOrderShare(w.ctx, orderId);
    expect(captureError.ok).toBe(false);
    expect((captureError as any).error).toMatch(/not approved yet/i);
    expect((await getShare(w.ctx, 1, "keisha"))!.parts[0].status).toBe("SENT");
    expect(w.sb.invoices.get((await getShare(w.ctx, 1, "keisha"))!.parts[0].invoiceId!)!.status).toBe("SENT");
    failuresLeft = 0;
    expect((await (await import("../../src/circle/shares")).captureOrderShare(w.ctx, orderId)).ok).toBe(true);
    expect((await getShare(w.ctx, 1, "keisha"))!.parts[0].status).toBe("MARKED_AS_PAID");
  });
});
