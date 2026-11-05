import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { PayPal } from "../../src/paypal/client";
import { getShare, startCircle } from "../../src/circle/shares";
import { consentSplit, proposeSplit } from "../../src/circle/split";
import worker from "../../src/worker";
import { world } from "../helpers/world";

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

async function prepared(pending = false) {
  const w = await world();
  w.circle.id = w.ctx.circleId = crypto.randomUUID().slice(0, 10);
  await w.store.put("circle", w.circle);
  await startCircle(w.ctx);
  const proposal = await proposeSplit(w.ctx, 1, "marisol", 6000);
  if (pending) w.sb.failInvoiceCreates(1, 400, 1);
  await consentSplit(w.ctx, proposal.split!.id, "marisol", "yes");
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => w.sb.fetchFn(input as any, init));
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(w.circle.id));
  await stub.create(await w.load());
  await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
    for (const [key, value] of w.store.data) await state.storage.put(key, value);
  });
  const post = (path: string, body: object) => worker.fetch(new Request(`https://ck.test/api/circles/${w.circle.id}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, {} as ExecutionContext);
  return { ...w, stub, post, splitId: proposal.split!.id };
}

it("passes part numbers from HTTP through the circle to card and checkout", async () => {
  const w = await prepared();
  const state: any = (await w.stub.state("https://ck.test", "tok-marisol")).body;
  const parts = state.rounds[0].shares.find((s: any) => s.memberId === "marisol").parts.filter((p: any) => p.status !== "CANCELLED");
  expect(parts[1].number).toBeTruthy();
  expect((await w.post("shares/1/marisol/order", { k: "tok-marisol", part: parts[1].number })).status).toBe(200);
  expect([...w.sb.orders.values()][0].cents).toBe(4000);
  expect((await w.post("shares/1/marisol/card", { k: "tok-marisol", part: parts[0].number })).status).toBe(200);
  expect(w.sb.invoices.get(parts[0].invoiceId)!.status).toBe("MARKED_AS_PAID");
  expect(w.sb.invoices.get(parts[1].invoiceId)!.status).toBe("SENT");
  const writes = w.sb.orders.size;
  const other = (await getShare(w.ctx, 1, "keisha"))!.parts[0].number;
  expect((await w.post("shares/1/marisol/card", { k: "tok-marisol", part: other })).status).toBe(409);
  expect((await w.post("shares/1/marisol/order", { k: "tok-marisol", part: other })).status).toBe(409);
  expect(w.sb.orders.size).toBe(writes);
});

it("authenticates and serializes pending split retries through HTTP", async () => {
  const w = await prepared(true);
  const path = `splits/${w.splitId}/retry`;
  expect((await w.post(path, { k: "org" })).status).toBe(403);
  expect((await w.post(path, { k: "tok-keisha" })).status).toBe(409);
  const results = await Promise.all([w.post(path, { k: "tok-marisol" }), w.post(path, { k: "tok-marisol" })]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const state: any = (await w.stub.state("https://ck.test", "tok-marisol")).body;
  expect(state.splits[0].status).toBe("applied");
  expect(state.messages.filter((m: any) => m.text.startsWith("Tu parte ahora son dos facturas"))).toHaveLength(1);
  expect(state.messages.filter((m: any) => m.to === "group")).toHaveLength(1);
});
