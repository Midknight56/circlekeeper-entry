// Routes a verified PayPal event to the circle that owns its id. The shared sandbox app sends every app's events to
// every subscribed URL, so an id that is not in our own index is answered and ignored.

import type { Hub } from "../circle/context";
import type { PayPalEvent } from "./webhooks";

export type RouteOutcome = "routed" | "ignored" | "duplicate";

export function idsOf(evt: PayPalEvent): { kind: "inv" | "batch" | "order"; id: string } | undefined {
  const r = evt.resource || {};
  const t = evt.event_type || "";
  if (t.startsWith("INVOICING.")) {
    const id = r.invoice?.id || r.id;
    return id ? { kind: "inv", id } : undefined;
  }
  if (t.startsWith("PAYMENT.PAYOUTS")) {
    const id = r.batch_header?.payout_batch_id || r.payout_batch_id;
    return id ? { kind: "batch", id } : undefined;
  }
  if (t.startsWith("PAYMENT.CAPTURE.") || t.startsWith("CHECKOUT.ORDER.")) {
    const id = r.supplementary_data?.related_ids?.order_id || (t.startsWith("CHECKOUT.ORDER.") ? r.id : undefined);
    return id ? { kind: "order", id } : undefined;
  }
  return undefined;
}

export async function routeEvent(
  evt: PayPalEvent,
  hub: Hub,
  dispatch: (circleId: string, evt: PayPalEvent) => Promise<void>,
  duplicate?: (circleId: string, evt: PayPalEvent) => Promise<void>,
): Promise<RouteOutcome> {
  const ref = idsOf(evt);
  if (!ref) return "ignored";
  const circleId = await hub.lookup(ref.kind, ref.id);
  if (!circleId) return "ignored";
  if (!(await hub.firstSeen(evt.id))) {
    await duplicate?.(circleId, evt);
    return "duplicate";
  }
  await dispatch(circleId, evt);
  return "routed";
}
