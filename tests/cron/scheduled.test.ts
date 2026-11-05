import { createExecutionContext, env, waitOnExecutionContext, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker";
import { draftCircle } from "../../src/circle/create";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import { PayPal } from "../../src/paypal/client";
import { sandbox } from "../helpers/sandbox";

const base = "https://ck.test";
const oldDate = new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10);

function fakePayPal() {
  const sb = sandbox();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
    sb.fetchFn(input as any, init),
  );
  return { sb, spy };
}

async function makeActiveCircle(demo: boolean, id: string) {
  const draft = draftCircle(DEMO_TEXT, "2026-10-23", {
    id,
    demo,
    startMonth: demo ? DEMO_START_MONTH : undefined,
  });
  const circle = draft.circle!;
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
  await stub.create(circle);
  await stub.start(base, circle.organiserToken);
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  await hub.registerCircle(circle.id, demo);
  return { circle, stub, hub };
}

async function makeSharesOverdue(stub: ReturnType<typeof env.CIRCLE.get>) {
  await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
    const shares = await state.storage.list<any>({ prefix: "share:" });
    for (const [key, share] of shares) {
      share.parts[0].dueDate = oldDate;
      await state.storage.put(key, share);
    }
  });
}

async function runScheduled(cron: string) {
  const ctx = createExecutionContext();
  await worker.scheduled({ cron, scheduledTime: Date.now() } as any, env, ctx);
  await waitOnExecutionContext(ctx);
}

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

describe("Worker scheduled handler", () => {
  it("reconciles recently active circles and skips circles with no activity", async () => {
    const { spy } = fakePayPal();
    const recent = await makeActiveCircle(false, "cronrecent01");
    await runInDurableObject(recent.stub, async (_instance: unknown, state: DurableObjectState) => {
      await state.storage.put("lastActivity", Date.now());
      await state.storage.put("refreshedAt", 0);
    });

    await runScheduled("*/5 * * * *");
    const getCalls = () => spy.mock.calls.filter(([input, init]) => {
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      return method === "GET";
    });
    expect(getCalls().length).toBeGreaterThan(0);

    await recent.hub.forgetCircle(recent.circle.id);
    const idle = await makeActiveCircle(false, "cronidle0001");
    await runInDurableObject(idle.stub, async (_instance: unknown, state: DurableObjectState) => {
      await state.storage.put("lastActivity", 0);
      await state.storage.put("refreshedAt", 0);
    });
    spy.mockClear();

    await runScheduled("*/5 * * * *");
    expect(getCalls()).toHaveLength(0);
    await idle.hub.forgetCircle(idle.circle.id);
  });

  it("sends daily reminders only for non-demo circles and tidies old hub events", async () => {
    const { sb } = fakePayPal();
    const live = await makeActiveCircle(false, "cronreminder01");
    const demo = await makeActiveCircle(true, "crondemo00001");
    await makeSharesOverdue(live.stub);
    await makeSharesOverdue(demo.stub);
    const expectedReminders = await runInDurableObject(live.stub, async (_instance: unknown, state: DurableObjectState) =>
      (await state.storage.list({ prefix: "share:" })).size,
    );
    await live.hub.firstSeen("cron-old-event");
    await runInDurableObject(live.hub, async (_instance: unknown, state: DurableObjectState) => {
      await state.storage.put("evt:cron-old-event", Date.now() - 31 * 86400_000);
    });

    await runScheduled("0 13 * * *");

    const reminders = sb.sent.filter((request) => request.method === "POST" && request.path.endsWith("/remind"));
    expect(reminders).toHaveLength(expectedReminders);
    await runInDurableObject(live.hub, async (_instance: unknown, state: DurableObjectState) => {
      expect(await state.storage.get("evt:cron-old-event")).toBeUndefined();
    });
    await live.hub.forgetCircle(live.circle.id);
    await demo.hub.forgetCircle(demo.circle.id);
  });

  it("does not throw when the hub lists a circle with no stored object", async () => {
    const hub = env.HUB.get(env.HUB.idFromName("hub"));
    const id = "cronmissing0001";
    await hub.registerCircle(id, false);
    await expect(runScheduled("*/5 * * * *")).resolves.toBeUndefined();
    await hub.forgetCircle(id);
  });
});
