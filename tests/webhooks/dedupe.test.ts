import { describe, expect, it } from "vitest";
import { routeEvent } from "../../src/paypal/router";
import { MemoryHub } from "../helpers/world";

describe("dedupe", () => {
  it("the same event id twice changes state once", async () => {
    const hub = new MemoryHub();
    await hub.index("inv", "INV2-OURS", "c1");
    let runs = 0;
    const evt = { id: "WH-SAME", event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: "INV2-OURS" } } };
    const first = await routeEvent(evt, hub, async () => {
      runs++;
    });
    const second = await routeEvent(evt, hub, async () => {
      runs++;
    });
    expect([first, second]).toEqual(["routed", "duplicate"]);
    expect(runs).toBe(1);
  });
});
