import { describe, expect, it } from "vitest";
import { routeEvent } from "../../src/paypal/router";
import { MemoryHub } from "../helpers/world";

const paid = (invoiceId: string, eventId = "WH-A") => ({
  id: eventId,
  event_type: "INVOICING.INVOICE.PAID",
  resource: { invoice: { id: invoiceId, status: "PAID" } },
});

describe("foreign events", () => {
  it("a PAID event for an invoice not in our index changes nothing", async () => {
    const hub = new MemoryHub();
    const dispatched: string[] = [];
    const out = await routeEvent(paid("INV2-NOT-OURS"), hub, async (circleId) => {
      dispatched.push(circleId);
    });
    expect(out).toBe("ignored");
    expect(dispatched).toEqual([]);
  });

  it("an event for our invoice reaches its circle", async () => {
    const hub = new MemoryHub();
    await hub.index("inv", "INV2-OURS", "c1");
    const dispatched: string[] = [];
    const out = await routeEvent(paid("INV2-OURS"), hub, async (circleId) => {
      dispatched.push(circleId);
    });
    expect(out).toBe("routed");
    expect(dispatched).toEqual(["c1"]);
  });

  it("payout events route by batch id, capture events by order id", async () => {
    const hub = new MemoryHub();
    await hub.index("batch", "BATCH1", "c2");
    await hub.index("order", "ORDER1", "c3");
    const got: string[] = [];
    await routeEvent(
      { id: "WH-B", event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS", resource: { batch_header: { payout_batch_id: "BATCH1" } } },
      hub,
      async (c) => {
        got.push(c);
      },
    );
    await routeEvent(
      { id: "WH-C", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_batch_id: "BATCH1", payout_item_id: "I1" } },
      hub,
      async (c) => {
        got.push(c);
      },
    );
    await routeEvent(
      {
        id: "WH-D",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP1", supplementary_data: { related_ids: { order_id: "ORDER1" } } },
      },
      hub,
      async (c) => {
        got.push(c);
      },
    );
    expect(got).toEqual(["c2", "c2", "c3"]);
  });
});
