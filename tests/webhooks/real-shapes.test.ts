import { describe, expect, it } from "vitest";
import cancelled from "../fixtures/webhooks/INVOICING.INVOICE.CANCELLED.json";
import paid from "../fixtures/webhooks/INVOICING.INVOICE.PAID.json";
import capture from "../fixtures/webhooks/PAYMENT.CAPTURE.COMPLETED.json";
import itemSucceeded from "../fixtures/webhooks/PAYMENT.PAYOUTS-ITEM.SUCCEEDED.json";
import batchDenied from "../fixtures/webhooks/PAYMENT.PAYOUTSBATCH.DENIED.json";
import batchSuccess from "../fixtures/webhooks/PAYMENT.PAYOUTSBATCH.SUCCESS.json";
import { idsOf, routeEvent } from "../../src/paypal/router";
import type { PayPalEvent } from "../../src/paypal/webhooks";
import { MemoryHub } from "../helpers/world";

const fixtures: { event: PayPalEvent; kind: "inv" | "batch" | "order"; id: string }[] = [
  { event: cancelled, kind: "inv", id: cancelled.resource.invoice.id },
  { event: paid, kind: "inv", id: paid.resource.invoice.id },
  { event: batchSuccess, kind: "batch", id: batchSuccess.resource.batch_header.payout_batch_id },
  { event: batchDenied, kind: "batch", id: batchDenied.resource.batch_header.payout_batch_id },
  { event: itemSucceeded, kind: "batch", id: itemSucceeded.resource.payout_batch_id },
  { event: capture, kind: "order", id: capture.resource.supplementary_data.related_ids.order_id },
];

describe("real PayPal webhook shapes", () => {
  it.each(fixtures)("routes $event.event_type by its PayPal id", async ({ event, kind, id }) => {
    expect(idsOf(event)).toEqual({ kind, id });

    const hub = new MemoryHub();
    await hub.index(kind, id, "circle-fixture");
    const dispatched: string[] = [];
    const dispatch = async (circleId: string) => { dispatched.push(circleId); };
    expect(await routeEvent(event, hub, dispatch)).toBe("routed");
    expect(dispatched).toEqual(["circle-fixture"]);

    expect(await routeEvent(event, new MemoryHub(), dispatch)).toBe("ignored");
    expect(await routeEvent(event, hub, dispatch)).toBe("duplicate");
    expect(dispatched).toEqual(["circle-fixture"]);
  });
});
