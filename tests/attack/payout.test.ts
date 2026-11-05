import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmRelease, onPayoutEvent, refreshPot, retryPayout } from "../../src/circle/gate";
import { proposeSwap, consentSwap } from "../../src/circle/swap";
import { getShare, payShareByTestCard, recordCashShare, startCircle } from "../../src/circle/shares";
import { stateFor } from "../../src/circle/state";
import { PayPal } from "../../src/paypal/client";
import { draftCircle } from "../../src/circle/create";
import { sandbox } from "../helpers/sandbox";
import { world } from "../helpers/world";

const ALL = ["keisha", "marisol", "dana", "theo", "amelie", "sam"];

afterEach(() => {
  vi.restoreAllMocks();
  PayPal.resetMemory();
});

async function paidRound() {
  const w = await world();
  await startCircle(w.ctx);
  for (const member of ALL) await recordCashShare(w.ctx, 1, member);
  return w;
}

describe("adversarial payout gate", () => {
  it("serializes five simultaneous taps from each confirmer to one payout", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const circle = draftCircle("A savings circle with Keisha, Marisol, Dana, Theo, Amelie and Sam", "2026-10-23").circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    await stub.start("https://ck.test", circle.organiserToken);
    for (const member of ALL) await stub.cash("https://ck.test", circle.organiserToken, 1, member);

    const confirmers = circle.rules.confirmers.map((id) => circle.members.find((member) => member.id === id)!);
    const requests: Promise<any>[] = [];
    for (let tap = 0; tap < 5; tap++) {
      requests.push(stub.confirm("https://ck.test", confirmers[0].token, 1, "test-network") as Promise<any>);
      requests.push(stub.confirm("https://ck.test", confirmers[1].token, 1, "test-network") as Promise<any>);
    }
    const taps = await Promise.all(requests);

    expect(taps.every((r: any) => r.status === 200)).toBe(true);
    expect(sb.calls("POST /v1/payments/payouts")).toHaveLength(1);
    expect(sb.payouts.size).toBe(1);
  });

  it("keeps payout identifiers stable through a failed answer, timeout, and successful retry", async () => {
    const w = await paidRound();
    const originalFetch = (w.ctx.pp as any).fetchFn as typeof fetch;
    const attempts: { senderBatchId: string; requestId: string }[] = [];
    let posts = 0;
    (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/payments/payouts" && init?.method === "POST") {
        posts++;
        const body = JSON.parse(String(init.body));
        const headers = new Headers(init.headers);
        attempts.push({ senderBatchId: body.sender_batch_header.sender_batch_id, requestId: headers.get("paypal-request-id")! });
        if (posts === 1) return Response.json({ name: "SERVICE_UNAVAILABLE" }, { status: 500 });
        if (posts === 2) throw new Error("socket timed out after request reached PayPal");
        return Response.json({ batch_header: { payout_batch_id: "BATCH-RETRIED", batch_status: "PENDING" } }, { status: 201 });
      }
      return originalFetch(input, init);
    };

    await confirmRelease(w.ctx, 1, "dana");
    const result = await confirmRelease(w.ctx, 1, "theo");
    expect(result).toMatchObject({ ok: true, paidOut: true });
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.map((x) => x.senderBatchId)).size).toBe(1);
    expect(new Set(attempts.map((x) => x.requestId)).size).toBe(1);
    const pot = await w.store.get<any>("pot:01");
    expect(pot).toMatchObject({ status: "paying", payoutBatchId: "BATCH-RETRIED" });
    expect(pot.payoutBatchId).toBeTruthy(); // the five minute reconciliation now has a batch to read
  });

  it("tracks pending, unclaimed, and returned states and reconciles a late success after safe retry refusal", async () => {
    const w = await paidRound();
    await confirmRelease(w.ctx, 1, "dana");
    await confirmRelease(w.ctx, 1, "theo");
    const pot = (await w.store.get<any>("pot:01"))!;
    const originalFetch = (w.ctx.pp as any).fetchFn as typeof fetch;
    let itemStatus = "PENDING";
    (w.ctx.pp as any).fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === `/v1/payments/payouts/${pot.payoutBatchId}`) {
        return Response.json({ batch_header: { payout_batch_id: pot.payoutBatchId, batch_status: "PENDING" }, items: [{ transaction_status: itemStatus }] });
      }
      return originalFetch(input, init);
    };
    const readPotState = async () => {
      const board = await stateFor(w.ctx, await w.load(), { role: "organiser" }, {});
      return (board.rounds as any[]).find((round) => round.round === 1).pot;
    };
    await refreshPot(w.ctx, pot);
    expect((await w.store.get<any>("pot:01")).status).toBe("paying");
    expect(await readPotState()).toMatchObject({ status: "paying", itemStatus: "PENDING" });
    itemStatus = "UNCLAIMED";
    await refreshPot(w.ctx, (await w.store.get<any>("pot:01"))!);
    expect((await w.store.get<any>("pot:01"))).toMatchObject({ status: "paying", itemStatus: "UNCLAIMED" });
    expect(await readPotState()).toMatchObject({ status: "paying", itemStatus: "UNCLAIMED" });
    itemStatus = "RETURNED";
    await refreshPot(w.ctx, (await w.store.get<any>("pot:01"))!);
    expect((await w.store.get<any>("pot:01"))).toMatchObject({ status: "failed", itemStatus: "RETURNED", refusal: "RETURNED" });
    expect(await readPotState()).toMatchObject({ status: "failed", itemStatus: "RETURNED", refusal: "RETURNED" });

    const retry = await retryPayout(w.ctx, 1);
    expect(retry).toMatchObject({ ok: false, error: expect.stringMatching(/already has this payout/i) });
    expect((await w.store.get<any>("pot:01")).status).toBe("failed");
    expect(w.sb.payouts.size).toBe(1);
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(1);
    const retried = (await w.store.get<any>("pot:01"))!;
    expect(retried.senderBatchId).toBe(pot.senderBatchId);
    expect(retried.requestId).toBe(pot.requestId);

    itemStatus = "SUCCESS";
    await onPayoutEvent(w.ctx, pot.payoutBatchId);
    const after = (await w.store.get<any>("pot:01"))!;
    expect(after).toMatchObject({ status: "paid", itemStatus: "SUCCESS", payoutBatchId: pot.payoutBatchId });
    expect(w.sb.payouts.size).toBe(1);
  });

  it("refuses a swap after the first confirmation has locked the pot recipient", async () => {
    const w = await paidRound();
    await confirmRelease(w.ctx, 1, "dana");
    const swap = await proposeSwap(w.ctx, "marisol", "sam");
    expect(swap.ok).toBe(false);
    expect((swap as any).error).toMatch(/already settled/i);
    const second = await confirmRelease(w.ctx, 1, "theo");
    expect(second.paidOut).toBe(true);
    expect([...w.sb.payouts.values()][0].receiver).toBe("m2@test");
  });

  it("rejects a non confirmer, a foreign circle key, and a wrong member id under the organiser key", async () => {
    const w = await paidRound();
    expect(await confirmRelease(w.ctx, 1, "sam")).toMatchObject({ ok: false, error: expect.stringMatching(/confirmers/i) });
    const circle = draftCircle("A savings circle with Keisha, Marisol, Dana, Theo, Amelie and Sam", "2026-10-23").circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    const foreignKey = await stub.confirm("https://ck.test", "a-member-key-from-another-circle", 1, "test-network");
    expect(foreignKey).toMatchObject({ status: 403, body: { ok: false } });
    const organiserWrongMember = await stub.cash("https://ck.test", circle.organiserToken, 1, "not-a-member");
    expect(organiserWrongMember).toMatchObject({ status: 409, body: { ok: false, error: "no share for that member in that round" } });
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
  });

  it("refuses at the exact daily cap and succeeds the next UTC day", async () => {
    const w = await paidRound();
    const attempts: string[] = [];
    w.ctx.hub.takePayout = async (day, cents, limit) => {
      attempts.push(day);
      expect(cents).toBe(60_000);
      expect(limit).toBe(600_000);
      return day !== "2026-12-01";
    };
    await confirmRelease(w.ctx, 1, "dana");
    const capped = await confirmRelease(w.ctx, 1, "theo");
    expect(capped).toMatchObject({ ok: false, error: expect.stringMatching(/sandbox payout limit.*tomorrow/i) });
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(0);
    w.setNow("2026-12-02T00:01:00Z");
    const tomorrow = await confirmRelease(w.ctx, 1, "theo");
    expect(tomorrow).toMatchObject({ ok: true, paidOut: true });
    expect(w.sb.calls("POST /v1/payments/payouts")).toHaveLength(1);
    expect(attempts).toEqual(["2026-12-01", "2026-12-02"]);
  });

  it("accepts cash marked paid and card paid shares only after fresh PayPal GETs", async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const member of ALL.slice(0, 5)) await recordCashShare(w.ctx, 1, member);
    expect((await payShareByTestCard(w.ctx, 1, "sam")).ok).toBe(true);
    expect((await getShare(w.ctx, 1, "keisha"))!.parts[0].status).toBe("MARKED_AS_PAID");
    const getsBefore = w.sb.calls("GET /v2/invoicing/invoices/").length;
    await confirmRelease(w.ctx, 1, "dana");
    const result = await confirmRelease(w.ctx, 1, "theo");
    expect(result.paidOut).toBe(true);
    expect(w.sb.calls("GET /v2/invoicing/invoices/").length - getsBefore).toBe(ALL.length);
    expect(w.sb.payouts.size).toBe(1);
  });
});
