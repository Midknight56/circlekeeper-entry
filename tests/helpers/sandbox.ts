// A small stateful stand in for the PayPal sandbox: invoices, payouts and orders behave like the real ones did on 22 Oct.
import { fakePayPal } from "./fake-paypal";

export interface FakeInvoice {
  id: string;
  number: string;
  status: string;
  cents: number;
  recipient: string;
  requestId?: string;
}

export function sandbox() {
  const invoices = new Map<string, FakeInvoice>();
  const payouts = new Map<string, { id: string; senderBatchId: string; cents: number; receiver: string; polls: number; denied?: boolean }>();
  const orders = new Map<string, { id: string; status: string; cents: number; customId: string }>();
  const ordersByRequestId = new Map<string, unknown>();
  const byRequestId = new Map<string, unknown>();
  let n = 0;
  const nextId = (p: string) => `${p}${String(++n).padStart(4, "0")}`;
  const cents = (v: string) => Math.round(Number(v) * 100);
  const orderBody = (o: { id: string; status: string; cents: number; customId: string }) => ({
    id: o.id, status: o.status,
    purchase_units: [{ custom_id: o.customId, payments: { captures: o.status === "COMPLETED"
      ? [{ id: "CAP" + o.id, status: "COMPLETED", amount: { currency_code: "USD", value: (o.cents / 100).toFixed(2) } }] : [] } }],
  });
  const idOf = (path: string, i: number) => path.split("/")[i];
  const failNext: Record<string, { status: number; name: string; remaining: number }> = {};
  const failCreates = { n: 0, status: 503, skip: 0 };
  let losePayoutAnswer = false;
  let nextRepeat: { batchId?: string; topLevel: boolean } | undefined;
  const repeatAnswer = (batchId?: string, topLevel = false) => {
    const links = batchId ? [{ href: `https://api.sandbox.paypal.com/v1/payments/payouts/${batchId}`, rel: "self", method: "GET", encType: "application/json" }] : [];
    return Response.json({
      name: "USER_BUSINESS_ERROR",
      message: "User business error.",
      debug_id: "dbg-dup",
      information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
      details: [{ field: "SENDER_BATCH_ID", location: "body", issue: "Batch with given sender_batch_id already exists", link: topLevel ? [] : links }],
      links: topLevel ? links : [],
    }, { status: 400 });
  };

  const fake = fakePayPal({
    "POST /v2/invoicing/invoices": (s) => {
      if (failCreates.skip > 0) failCreates.skip--;
      else if (failCreates.n > 0) {
        failCreates.n--;
        return Response.json({ name: "SERVICE_UNAVAILABLE", debug_id: "dbg-503" }, { status: failCreates.status });
      }
      const rid = s.headers["paypal-request-id"];
      if (rid && byRequestId.has(rid)) return Response.json(byRequestId.get(rid), { status: 201 });
      for (const existing of invoices.values()) {
        if (existing.number === s.body.detail.invoice_number) {
          return Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DUPLICATE_INVOICE_NUMBER", field: "/detail/invoice_number" }] }, { status: 422 });
        }
      }
      const inv: FakeInvoice = {
        id: nextId("INV2-TEST-"),
        number: s.body.detail.invoice_number,
        status: "DRAFT",
        cents: cents(s.body.items[0].unit_amount.value),
        recipient: s.body.primary_recipients[0].billing_info.email_address,
      };
      invoices.set(inv.id, inv);
      const body = { id: inv.id, status: "DRAFT" };
      if (rid) byRequestId.set(rid, body);
      return Response.json(body, { status: 201 });
    },
    "POST /v2/invoicing/search-invoices": (s) => {
      const items = [...invoices.values()]
        .filter((i) => i.number === s.body.invoice_number)
        .map((i) => ({ id: i.id, status: i.status, detail: { invoice_number: i.number } }));
      return Response.json({ items, total_items: items.length });
    },
    "POST /v2/invoicing/invoices/{id}/send": (s) => {
      const inv = invoices.get(idOf(s.path, 4));
      if (!inv) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      if (inv.status !== "DRAFT") {
        return Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVOICE_ALREADY_SENT", field: "invoiceId" }] }, { status: 422 });
      }
      inv.status = "SENT";
      return Response.json({}, { status: 200 });
    },
    "GET /v2/invoicing/invoices/{id}": (s) => {
      const inv = invoices.get(idOf(s.path, 4));
      if (!inv) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      return Response.json({
        id: inv.id,
        status: inv.status,
        detail: { invoice_number: inv.number, metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${inv.id}` } },
      });
    },
    "POST /v2/invoicing/invoices/{id}/payments": (s) => {
      const inv = invoices.get(idOf(s.path, 4));
      if (!inv) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      inv.status = "MARKED_AS_PAID";
      return Response.json({ payment_id: "EXTR-" + inv.id }, { status: 200 });
    },
    "POST /v2/invoicing/invoices/{id}/cancel": (s) => {
      const inv = invoices.get(idOf(s.path, 4));
      if (!inv) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      inv.status = "CANCELLED";
      return new Response(null, { status: 204 });
    },
    "POST /v2/invoicing/invoices/{id}/remind": () => new Response(null, { status: 204 }),
    "POST /v1/payments/payouts": (s) => {
      if (failNext.payout) {
        const f = failNext.payout;
        if (--f.remaining === 0) delete failNext.payout;
        return Response.json({ name: f.name, debug_id: "dbg-payout" }, { status: f.status });
      }
      if (nextRepeat) {
        const repeat = nextRepeat;
        nextRepeat = undefined;
        return repeatAnswer(repeat.batchId, repeat.topLevel);
      }
      const sbid = s.body.sender_batch_header.sender_batch_id;
      for (const p of payouts.values()) {
        if (p.senderBatchId === sbid) return repeatAnswer(p.id);
      }
      const id = nextId("BATCH");
      payouts.set(id, { id, senderBatchId: sbid, cents: cents(s.body.items[0].amount.value), receiver: s.body.items[0].receiver, polls: 0 });
      if (losePayoutAnswer) {
        losePayoutAnswer = false;
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error("payout answer lost")); } }), { status: 201 });
      }
      return Response.json({ batch_header: { payout_batch_id: id, batch_status: "PENDING", sender_batch_header: { sender_batch_id: sbid } } }, { status: 201 });
    },
    "GET /v1/payments/payouts/{id}": (s) => {
      if (failNext.payoutRead) {
        const f = failNext.payoutRead;
        if (--f.remaining === 0) delete failNext.payoutRead;
        return Response.json({ name: f.name, debug_id: "dbg-payout-read" }, { status: f.status });
      }
      const p = payouts.get(idOf(s.path, 4));
      if (!p) return Response.json({ name: "INVALID_RESOURCE_ID" }, { status: 404 });
      p.polls++;
      if (p.denied) return Response.json({ batch_header: { payout_batch_id: p.id, batch_status: "DENIED", sender_batch_header: { sender_batch_id: p.senderBatchId } } });
      return Response.json({
        batch_header: { payout_batch_id: p.id, batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: p.senderBatchId } },
        items: [{ payout_item_id: "ITEM" + p.id, transaction_status: "SUCCESS", payout_item: { amount: { value: (p.cents / 100).toFixed(2), currency: "USD" } } }],
      });
    },
    "POST /v2/checkout/orders": (s) => {
      const requestId = s.headers["paypal-request-id"];
      if (ordersByRequestId.has(requestId)) return Response.json(ordersByRequestId.get(requestId));
      const id = nextId("ORDER");
      if (s.body.payment_source?.card) {
        orders.set(id, { id, status: "COMPLETED", cents: cents(s.body.purchase_units[0].amount.value), customId: s.body.purchase_units[0].custom_id });
        const body = orderBody(orders.get(id)!);
        ordersByRequestId.set(requestId, body);
        return Response.json(body, { status: 201 });
      }
      orders.set(id, { id, status: "PAYER_ACTION_REQUIRED", cents: cents(s.body.purchase_units[0].amount.value), customId: s.body.purchase_units[0].custom_id });
      const body = { id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      ordersByRequestId.set(requestId, body);
      return Response.json(body);
    },
    "POST /v2/checkout/orders/{id}/capture": (s) => {
      const o = orders.get(idOf(s.path, 4));
      if (!o) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      if (o.status !== "APPROVED") return Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] }, { status: 422 });
      o.status = "COMPLETED";
      return Response.json(orderBody(o), { status: 201 });
    },
    "GET /v2/checkout/orders/{id}": (s) => {
      const o = orders.get(idOf(s.path, 4));
      if (!o) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      return Response.json(orderBody(o));
    },
  });

  return {
    ...fake,
    /** Makes an invoice exist in PayPal as if our create call succeeded but its answer was lost. */
    plantInvoice(number: string, cents: number, status = "DRAFT") {
      const id = nextId("INV2-TEST-");
      invoices.set(id, { id, number, status, cents, recipient: "planted" });
      return id;
    },
    invoices,
    payouts,
    orders,
    payInvoice(id: string) {
      invoices.get(id)!.status = "PAID";
    },
    approveOrder(id: string) {
      orders.get(id)!.status = "APPROVED";
    },
    /** After `skip` invoice creates succeed, the next `n` fail with `status`, as if PayPal went down mid round. */
    failInvoiceCreates(n: number, status: number, skip = 3) {
      failCreates.skip = skip;
      failCreates.n = n;
      failCreates.status = status;
    },
    failNextPayout(status: number, name: string, remaining = 1) {
      failNext.payout = { status, name, remaining };
    },
    failNextPayoutRead(status: number, name: string, remaining = 1) {
      failNext.payoutRead = { status, name, remaining };
    },
    loseNextPayoutAnswer() {
      losePayoutAnswer = true;
    },
    repeatNextPayout(batchId?: string, topLevel = false) {
      nextRepeat = { batchId, topLevel };
    },
    denyPayout(batchId: string) {
      payouts.get(batchId)!.denied = true;
    },
  };
}
