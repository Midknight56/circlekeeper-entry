import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import { keys, type Pot, type Share } from "../../src/circle/model";
import { PayPal } from "../../src/paypal/client";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

describe("the guard panel route", () => {
  it("exercises the recipient attack with no paid shares and missing invoices only in the copy", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    sb.failInvoiceCreates(3, 422);
    await stub.start("https://ck.test", circle.organiserToken);
    await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
      await state.storage.delete(keys.share(1, circle.members[3].id));
      const share = (await state.storage.get<Share>(keys.share(1, circle.members[4].id)))!;
      share.parts[0].status = "CANCELLED";
      await state.storage.put(keys.share(1, share.memberId), share);
    });
    const snapshot = () => runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => ({
      shares: [...await state.storage.list({ prefix: "share:" })],
      pots: [...await state.storage.list({ prefix: "pot:" })],
    }));
    const before = await snapshot();
    expect([...sb.invoices.values()].every((invoice) => invoice.status === "SENT")).toBe(true);
    expect(sb.invoices.size).toBe(3);
    sb.sent.length = 0;
    const response = await worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/guard`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: circle.organiserToken }),
    }), env, {} as ExecutionContext);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.rows[0].result).toBe("stopped");
    const turn = circle.members.find((m) => m.id === circle.rotation[0].memberId)!;
    expect(result.rows[0].attempted).toEqual([{
      method: "POST", path: "/v1/payments/payouts", items: [{ receiver: `m${turn.slot}@test`, amount: "600.00" }],
    }]);
    expect(result.rows[0].tried.en).toContain("In an isolated copy, every share of this round was marked paid");
    expect(result.rows[0].stoppedBy.en).toContain(`m${turn.slot}@test $600.00`);
    expect(result.rows[1].result).toBe("stopped");
    expect(result.rows[1].tried.en).toContain("0 of 6 shares paid");
    expect(result.rows[1].attempted).toHaveLength(0);
    expect(result.rows.every((row: any) => row.paypalWrites === 0)).toBe(true);
    expect(sb.sent.filter((call) => call.method === "POST" && call.path !== "/v1/oauth2/token")).toEqual([]);
    expect(sb.sent.filter((call) => call.method === "GET" && call.path.startsWith("/v2/invoicing/invoices/guard-"))).toEqual([]);
    for (const invoice of sb.invoices.values()) {
      expect(sb.calls(`GET /v2/invoicing/invoices/${invoice.id}`)).toHaveLength(1);
      expect(invoice.status).toBe("SENT");
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(["waiting for a date", "already sent"])("reports why the recipient attack was not exercised when the pot is %s", async (held) => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    await stub.start("https://ck.test", circle.organiserToken);
    await runInDurableObject(stub, async (_instance: unknown, state: DurableObjectState) => {
      const pot = (await state.storage.get<Pot>(keys.pot(1)))!;
      if (held === "waiting for a date") pot.waitUntil = "2099-01-01";
      else pot.status = "paying";
      await state.storage.put(keys.pot(1), pot);
    });
    sb.sent.length = 0;
    const result = (await stub.guard("https://ck.test", circle.organiserToken)).body as any;
    const row = result.rows[0];
    expect(row.result).toBe("not_exercised");
    expect(row.attempted).toEqual([]);
    expect(row.paypalWrites).toBe(0);
    for (const lang of ["en", "es", "fr"]) {
      expect(row.stoppedBy[lang]).toContain(held === "waiting for a date" ? "the circle agreed to wait until" : "this pot was already sent");
    }
    expect(sb.sent.filter((call) => call.method === "POST" && call.path !== "/v1/oauth2/token")).toEqual([]);
  });

  it("requires the organiser key", async () => {
    const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    await env.CIRCLE.get(env.CIRCLE.idFromName(circle.id)).create(circle);
    const post = (k: string) => worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/guard`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k }),
    }), env, {} as ExecutionContext);

    expect((await post(circle.members[0].token)).status).toBe(403);
    expect((await post("wrong-key")).status).toBe(403);
    expect((await post(circle.organiserToken)).status).toBe(200);
  });

  it("runs three attacks without a PayPal write or a change to the circle book", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    await stub.start("https://ck.test", circle.organiserToken);
    const initial = await stub.state("https://ck.test", circle.organiserToken) as any;
    const invoices = initial.body.rounds[0].shares.map((share: any) => share.parts[0].invoiceId as string);
    for (const invoice of invoices.slice(0, 5)) sb.payInvoice(invoice);

    const snapshot = async () => {
      const board = (await stub.state("https://ck.test", circle.organiserToken) as any).body;
      return JSON.stringify({ rotation: board.rotation, rounds: board.rounds.map((r: any) => ({ pot: r.pot, shares: r.shares })) });
    };
    const before = await snapshot();
    const response = await worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/guard`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: circle.organiserToken }),
    }), env, {} as ExecutionContext);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row: any) => row.attack.en)).toEqual([
      "Pay the pot to someone else", "Pay before the pot is full", "A message is not an instruction",
    ]);
    expect(result.rows[0].stoppedBy.en).toContain("Attempted payout:");
    expect(result.rows[0].result).toBe("stopped");
    expect(result.rows[1].tried.en).toContain("5 of 6 shares paid in PayPal");
    expect(result.rows[1].stoppedBy.en).toContain("5 of 6 shares paid in PayPal");
    expect(result.rows[2].tried.en).toContain("scripted");
    expect(result.rows[2].tried.en).toContain("0 neurons");
    expect(result.rows.every((row: any) => ["en", "es", "fr"].every((lang) => row.attack[lang] && row.tried[lang] && row.stoppedBy[lang]))).toBe(true);
    expect(result.rows.every((row: any) => row.paypalWrites === 0)).toBe(true);
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
    expect(await snapshot()).toBe(before);
  });

  it.each([false, true])("reports the actual release payload, including a broken release (%s)", async (broken) => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    if (broken) {
      const request = PayPal.prototype.request;
      vi.spyOn(PayPal.prototype, "request").mockImplementation(function (this: PayPal, method, path, body: any, opts) {
        if (path === "/v1/payments/payouts") {
          body.items[0].receiver = "attacker@example.test";
          body.items[0].amount.value = "0.01";
        }
        return request.call(this, method, path, body, opts);
      });
    }
    const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    await stub.start("https://ck.test", circle.organiserToken);
    const board = (await stub.state("https://ck.test", circle.organiserToken)).body as any;
    for (const share of board.rounds[0].shares) sb.payInvoice(share.parts[0].invoiceId);
    const result = (await stub.guard("https://ck.test", circle.organiserToken)).body as any;
    expect(result.rows.map((row: any) => row.result)).toEqual([broken ? "not_stopped" : "stopped", "stopped", "stopped"]);
    expect(result.rows.map((row: any) => row.paypalWrites)).toEqual([0, 0, 0]);
    const attempt = result.rows[0].attempted.find((a: any) => a.path === "/v1/payments/payouts");
    const turn = circle.members.find((m) => m.id === circle.rotation[0].memberId)!;
    expect(attempt.items).toEqual([{ receiver: broken ? "attacker@example.test" : `m${turn.slot}@test`, amount: broken ? "0.01" : "600.00" }]);
    expect(result.rows[1].attempted).toHaveLength(0);
    expect(result.rows[2].attempted).toHaveLength(0);
    expect(result.rows[2].tried.en).toContain("scripted");
    expect(result.rows[2].tried.en).toContain("0 neurons");
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("reports interrupted attacks as not exercised and still runs the scripted gate check", async () => {
    const circle = draftCircle(DEMO_TEXT, "2026-10-23", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    await stub.start("https://ck.test", circle.organiserToken);
    vi.spyOn(PayPal.prototype, "request").mockRejectedValue(new Error("read interrupted"));
    const response = await worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/guard`, { method: "POST", body: JSON.stringify({ k: circle.organiserToken }) }), env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.rows.map((row: any) => row.result)).toEqual(["not_exercised", "not_exercised", "stopped"]);
    for (const row of result.rows.slice(0, 2)) expect(row.resultText.en).toBe("not exercised");
  });
});
