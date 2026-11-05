import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import { PayPal } from "../../src/paypal/client";
import { sandbox } from "../helpers/sandbox";

// The Durable Object calls the global fetch; here it reaches the fake sandbox, with a little delay like a network.
function slowSandbox() {
  const sb = sandbox();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 5));
    return sb.fetchFn(input as any, init);
  });
  return { sb, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

describe("one action at a time per circle", () => {
  it("a Start and a board refresh at the same moment send each share once", async () => {
    const { sb } = slowSandbox();
    const draft = draftCircle(DEMO_TEXT, "2026-11-20", { demo: true, startMonth: DEMO_START_MONTH });
    const c = draft.circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
    await stub.create(c);
    const base = "https://ck.test";
    const start = stub.start(base, c.organiserToken);
    await new Promise((r) => setTimeout(r, 12));
    const polls = [stub.state(base, c.organiserToken), stub.state(base, c.organiserToken)];
    const [res] = (await Promise.all([start as Promise<unknown>, ...(polls as Promise<unknown>[])])) as unknown[];
    expect((res as any).status).toBe(200);
    expect(sb.invoices.size).toBe(6);
    const refused = sb.sent.filter((s) => s.method === "POST" && s.path.startsWith("/v2/invoicing/invoices")).length;
    // 6 creates and 6 sends, nothing more
    expect(refused).toBe(12);
  });
});

describe("the 5 minute check on a real circle object", () => {
  it("skips a circle nobody touched for 2 hours, and checks a busy one", async () => {
    const { runInDurableObject } = await import("cloudflare:test");
    const { sb } = slowSandbox();
    const draft = draftCircle(DEMO_TEXT, "2026-11-20", { demo: true, startMonth: DEMO_START_MONTH });
    const c = draft.circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
    await stub.create(c);
    await stub.start("https://ck.test", c.organiserToken);
    const reads = () => sb.sent.filter((s) => s.method === "GET").length;
    await runInDurableObject(stub, async (_i: unknown, state: DurableObjectState) => {
      await state.storage.put("lastActivity", 0);
      await state.storage.put("refreshedAt", 0);
    });
    const before = reads();
    await stub.cron("https://ck.test", "reconcile");
    expect(reads()).toBe(before);
    await runInDurableObject(stub, async (_i: unknown, state: DurableObjectState) => {
      await state.storage.put("lastActivity", Date.now());
    });
    await stub.cron("https://ck.test", "reconcile");
    expect(reads()).toBeGreaterThan(before);
  });
});
