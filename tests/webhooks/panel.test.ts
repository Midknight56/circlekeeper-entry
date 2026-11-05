import { describe, expect, it } from "vitest";
import { countWebhookDuplicate, recordWebhook } from "../../src/circle/webhook-log";
import { stateFor, viewerFor } from "../../src/circle/state";
import { routeEvent } from "../../src/paypal/router";
import { world } from "../helpers/world";
// @ts-ignore Browser module is intentionally plain JavaScript.
import { guardRows } from "../../public/js/guard-panel.js";

describe("organiser panels", () => {
  it("records a verified routed webhook and counts duplicate deliveries on its entry", async () => {
    const w = await world();
    await w.hub.index("inv", "INV2-PANEL-1", w.circle.id);
    const evt = {
      id: "WH-PANEL-1",
      event_type: "INVOICING.INVOICE.PAID",
      resource: { id: "INV2-PANEL-1" },
    };
    const routed = () => routeEvent(evt, w.hub, async (_circleId, event) => {
      await recordWebhook(w.store, {
        id: event.id,
        at: w.ctx.now().toISOString(),
        eventType: event.event_type,
        resourceId: "INV2-PANEL-1",
        verified: "SUCCESS",
      });
    }, async (_circleId, event) => countWebhookDuplicate(w.store, event.id));

    expect(await routed()).toBe("routed");
    expect(await routed()).toBe("duplicate");
    expect(await w.store.get("webhooks")).toEqual([{
      id: "WH-PANEL-1",
      at: w.ctx.now().toISOString(),
      eventType: "INVOICING.INVOICE.PAID",
      resourceId: "INV2-PANEL-1",
      verified: "SUCCESS",
      duplicates: 1,
    }]);
  });

  it("does not include webhook records in member state", async () => {
    const w = await world();
    await recordWebhook(w.store, {
      id: "WH-MEMBER-HIDDEN",
      at: w.ctx.now().toISOString(),
      eventType: "INVOICING.INVOICE.PAID",
      resourceId: "INV2-HIDDEN",
      verified: "SUCCESS",
    });
    const member = viewerFor(w.circle, w.circle.members[0].token)!;
    const output = await stateFor(w.ctx, w.circle, member, {});
    expect(output).not.toHaveProperty("webhooks");
  });

  it("renders the reported result, attempts and write count in each guard row", () => {
    const rendered = guardRows([{
      attack: { en: "Test attack", es: "", fr: "" },
      tried: { en: "A test attempt", es: "", fr: "" },
      stoppedBy: { en: "A rule", es: "", fr: "" },
      paypalWrites: 2,
      result: "not_stopped",
      attempted: [{ method: "POST", path: "/v1/payments/payouts", items: [{ receiver: "attacker@example.test", amount: "0.01" }] }],
    }]);
    expect(rendered[0]).toMatchObject({ attack: "Test attack", tried: "A test attempt", stoppedBy: "A rule", paypalWrites: 2, result: "not stopped" });
    expect(rendered[0].attempted[0].items[0].receiver).toBe("attacker@example.test");
  });
});
