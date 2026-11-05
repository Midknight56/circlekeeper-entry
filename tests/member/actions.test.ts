import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { PayPal } from "../../src/paypal/client";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";
import { world } from "../helpers/world";
import { runTurn } from "../../src/ai/loop";
import { CappedModel } from "../../src/ai/model";
import { validateAction } from "../../src/ai/tools";
import { startCircle } from "../../src/circle/shares";

afterEach(() => { vi.restoreAllMocks(); PayPal.resetMemory(); });
const base = "https://ck.test";
async function own(allowed = true, lang: "en" | "es" | "fr" = "en") {
  const sb = sandbox();
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
  const circle = draftCircle("4 of us: Alice, Bob, Cara and Dan. $100 a month from December.", "2026-11-05").circle!;
  circle.rules.shortShare.allowed = allowed;
  circle.members[0].lang = lang;
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
  await stub.create(circle);
  const post = async (route: string, fields: Record<string, unknown> = {}, k = circle.members[0].token) => {
    const response = await worker.fetch(new Request(`${base}/api/circles/${circle.id}/${route}`, { method: "POST", body: JSON.stringify({ k, ...fields }) }), env, {} as ExecutionContext);
    return { status: response.status, body: await response.json() as any };
  };
  return { circle, stub, post };
}

describe("member buttons with live answers off", () => {
  it.each([
    ["en", "Live answers are off on this site", "Use the buttons on this page"],
    ["es", "Las respuestas en vivo están desactivadas en este sitio", "Usa los botones de esta página"],
    ["fr", "Les réponses en direct sont désactivées sur ce site", "Utilise les boutons de cette page"],
  ] as const)("says the site is off in %s, with no promise about tomorrow", async (lang, off, buttons) => {
    const { circle, stub, post } = await own(true, lang);
    expect((await post("chat", { text: "Can I split?" })).status).toBe(200);
    const board = (await stub.state(base, circle.members[0].token)).body as any;
    const reply = board.messages.find((m: any) => m.from === "treasurer").text;
    expect(reply).toContain(off);
    expect(reply).not.toMatch(/until tomorrow|hasta mañana|jusqu'à demain/);
    expect(reply).toContain(buttons);
  });

  it("keeps tomorrow for a real daily cap, without calling the inner model", async () => {
    const w = await world();
    const complete = vi.fn(() => { throw new Error("must not call a model"); });
    const model = new CappedModel({ complete }, { take: async () => false }, "visitor", () => "today", 1);
    const reply = await runTurn(w.ctx, model, { role: "member", memberId: "keisha" }, "Hello");
    expect(reply.said[0].text).toContain("resting until tomorrow");
    expect(complete).not.toHaveBeenCalled();
  });

  it("proposes the same split as the chat tool and uses the existing own consent", async () => {
    const { circle, stub, post } = await own();
    await stub.start(base, circle.organiserToken);
    const r = await post("member/split", { nowCents: 6000 });
    expect(r.status).toBe(200);
    const w = await world();
    await startCircle(w.ctx);
    const tool = validateAction({ tool: "propose_split", args: { round: 1, member_id: "keisha", now_cents: 6000 } });
    expect(tool.ok).toBe(true);
    if (!tool.ok) throw new Error("missing split tool");
    await tool.tool.run(w.ctx, { role: "member", memberId: "keisha" }, tool.args);
    const chat = [...(await w.store.list<any>({ prefix: "split:" })).values()][0];
    expect(r.body.split).toMatchObject({ round: chat.round, nowCents: chat.nowCents, laterCents: chat.laterCents, status: chat.status, memberId: circle.members[0].id });
    expect((await post(`splits/${r.body.split.id}/consent`, { answer: "yes" }, circle.members[1].token)).status).toBe(409);
    expect((await post(`splits/${r.body.split.id}/consent`, { answer: "yes" })).status).toBe(200);
    const board = (await stub.state(base, circle.members[0].token)).body as any;
    expect(board.rounds[0].shares.find((s: any) => s.memberId === circle.members[0].id).parts.filter((p: any) => p.status !== "CANCELLED").map((p: any) => p.cents)).toEqual([6000, 4000]);
  });

  it("refuses with the short share rule's reason", async () => {
    const { post } = await own(false);
    const r = await post("member/split", { nowCents: 6000 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("this circle does not allow short shares");
  });

  it("lists partners and asks for a swap that still needs both consents", async () => {
    const { circle, stub, post } = await own();
    const found = await post("member/partners");
    expect(found.status).toBe(200);
    const partner = found.body.partners.find((p: any) => p.fits);
    const asked = await post("member/swap", { to: partner.memberId });
    expect(asked.status).toBe(200);
    expect(asked.body.swap).toMatchObject({ from: circle.members[0].id, to: partner.memberId, status: "asked", consents: {} });
    const board = (await stub.state(base, circle.organiserToken)).body as any;
    expect(board.circle.rotation).toEqual(circle.rotation);
    expect((await post("member/partners", {}, circle.organiserToken)).status).toBe(403);
  });
});
