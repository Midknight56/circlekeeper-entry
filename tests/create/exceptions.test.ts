import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { parseCircleText } from "../../src/circle/words";
import { draftCircle } from "../../src/circle/create";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";
import { sandbox } from "../helpers/sandbox";
import worker from "../../src/worker";

const base = "4 of us: Alice, Bob, Cara and Dan. $100 a month from December.";
afterEach(() => vi.restoreAllMocks());

it.each([
  ["Pay on the 25th except February.", "except February."],
  ["No short shares unless Sam agrees.", "unless Sam agrees."],
  ["Amounts private except for Sam.", "except for Sam."],
  ["The pot waits until Sam agrees.", "until Sam agrees."],
  ["Pay on the 25th with a holiday exception.", "with a holiday exception."],
])("preserves unsupported text inside a recognised clause: %s", (rule, unused) => {
  const parsed = parseCircleText(`${base} ${rule}`, "2026-11-05");
  expect(parsed.unused).toEqual([rule]);
  expect(parsed.unused[0]).toContain(unused);
});

it("blocks direct Start before any invoice when unused text is unresolved", async () => {
  const w = await world();
  w.circle.unused = ["except February."];
  await w.store.put("circle", w.circle);
  expect((await startCircle(w.ctx)).ok).toBe(false);
  expect((await w.load()).status).toBe("draft");
  expect(w.sb.invoices.size).toBe(0);
});

it("requires explicit organiser acceptance of the current omitted text through the API", async () => {
  const sb = sandbox();
  vi.spyOn(globalThis, "fetch").mockImplementation(sb.fetchFn);
  const c = draftCircle(`${base} Pay on the 25th except February.`, "2026-11-05").circle!;
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
  await stub.create(c);
  const post = (route: string, body: unknown) => worker.fetch(new Request(`https://ck.test/api/circles/${c.id}/${route}`, { method: "POST", body: JSON.stringify(body) }), env, {} as ExecutionContext);
  expect((await post("start", { k: c.organiserToken })).status).not.toBe(200);
  expect(sb.invoices.size).toBe(0);
  expect((await post("rules", { k: c.members[0].token, rules: { ...c.rules, acceptUnused: true } })).status).toBe(403);
  expect((await post("rules", { k: c.organiserToken, rules: { ...c.rules, acceptUnused: "true" } })).status).toBe(400);
  expect((await post("rules", { k: c.organiserToken, rules: { ...c.rules, acceptUnused: true } })).status).toBe(200);
  expect((await post("start", { k: c.organiserToken })).status).toBe(200);
  expect(sb.invoices.size).toBe(4);
});
