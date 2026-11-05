import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftCircle } from "../../src/circle/create";
import { parseCircleText } from "../../src/circle/words";
import { DEMO_START_MONTH, DEMO_TEXT } from "../../src/demo";
import { PayPal } from "../../src/paypal/client";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";

afterEach(() => { vi.restoreAllMocks(); PayPal.resetMemory(); });
const text = "4 of us: Alice, Bob, Cara and Dan. $100 a month from December.";
describe("draft rules", () => {
  it("reads negative rules and reports unknown sentences", () => {
    const parsed = parseCircleText(`${text} No short shares. Late shares must wait. Bring snacks.`, "2026-11-05") as any;
    expect(parsed.rules.shortShare.allowed).toBe(false);
    expect(parsed.rules.missed.action).toBe("pot_waits");
    expect(parsed.unused).toEqual(["Bring snacks."]);
    const c = draftCircle(`${text} No short shares. Late shares must wait.`, "2026-11-05").circle!;
    expect(c.rules.shortShare.allowed).toBe(false);
    expect(c.rules.missed.action).toBe("pot_waits");
  });

  it.each([
    ["No splitting. The pot waits. 3 days grace. Amounts private.", false, "pot_waits", 3, true],
    ["Short shares allowed. Move to the end. Wait 5 days. Amounts shared.", true, "move_to_end", 5, false],
    ["Splitting allowed. Late shares wait.", true, "pot_waits", undefined, undefined],
  ])("reads rule forms: %s", (sentence, allowed, action, graceDays, privacy) => {
    const p = parseCircleText(`${text} ${sentence}`, "2026-11-05") as any;
    expect(p.rules.shortShare.allowed).toBe(allowed);
    expect(p.rules.missed.action).toBe(action);
    if (graceDays !== undefined) expect(p.rules.missed.graceDays).toBe(graceDays);
    if (privacy !== undefined) expect(p.rules.privacy).toBe(privacy);
    expect(p.unused).toEqual([]);
  });

  it("updates only an organiser's draft and locks after Start", async () => {
    const sb = sandbox();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
    const c = draftCircle(`${text} Bring snacks.`, "2026-11-05").circle!;
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
    await stub.create(c);
    const rules = { ...c.rules, privacy: false, shortShare: { ...c.rules.shortShare, allowed: false, minNowCents: 3000 }, missed: { action: "pot_waits", graceDays: 5 }, confirmers: c.members.slice(2).map((m) => m.id) };
    const update = (k: string, value = rules) => worker.fetch(new Request(`https://ck.test/api/circles/${c.id}/rules`, { method: "POST", body: JSON.stringify({ k, rules: value }) }), env, {} as ExecutionContext);
    expect((await update(c.members[0].token)).status).toBe(403);
    expect((await update(c.organiserToken, { ...rules, confirmers: ["alice", "alice"] })).status).toBe(400);
    expect((await update(c.organiserToken)).status).toBe(200);
    const state = (await stub.state("https://ck.test", c.organiserToken)).body as any;
    expect(state.circle.rules).toEqual(rules);
    expect(state.circle.unused).toEqual(["Bring snacks."]);
    expect((await stub.start("https://ck.test", c.organiserToken)).status).not.toBe(200);
    expect((await update(c.organiserToken, { ...rules, acceptUnused: true } as typeof rules)).status).toBe(200);
    expect((await stub.start("https://ck.test", c.organiserToken)).status).toBe(200);
    expect((await update(c.organiserToken)).status).toBe(409);
    expect(((await stub.state("https://ck.test", c.organiserToken)).body as any).circle.rules).toEqual(rules);
  });

  it("keeps the recorded demo's rules exactly as before", async () => {
    const c = draftCircle(DEMO_TEXT, "2026-11-05", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
    expect(c.rules).toEqual({ privacy: true, shortShare: { allowed: true, minNowCents: 5000, laterDays: 14 }, missed: { graceDays: 3, action: "move_to_end" }, confirmers: ["dana", "theo"] });
    const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
    await stub.create(c);
    const response = await worker.fetch(new Request(`https://ck.test/api/circles/${c.id}/rules`, { method: "POST", body: JSON.stringify({ k: c.organiserToken, rules: { ...c.rules, privacy: false } }) }), env, {} as ExecutionContext);
    expect(response.status).toBe(409);
  });
});
