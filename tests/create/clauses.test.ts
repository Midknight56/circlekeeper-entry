import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { parseCircleText } from "../../src/circle/words";
import { draftCircle } from "../../src/circle/create";
import { PayPal } from "../../src/paypal/client";
import { DEMO_TEXT, DEMO_START_MONTH } from "../../src/demo";
import worker from "../../src/worker";
import { sandbox } from "../helpers/sandbox";
import { rulesSummary } from "../../public/js/rules-summary.js";

afterEach(() => { vi.restoreAllMocks(); PayPal.resetMemory(); });
const text = "Ana, Ben, Cleo and Dev. $20.50 each month from January 2027.";

it.each(["pay on the 25th", "on the 25th of each month", "day 25"])("reads each clause and %s", (day) => {
  const parsed = parseCircleText(`${text} No short shares, and ${day}.`, "2026-11-05");
  expect(parsed.rules).toMatchObject({ shortShare: { allowed: false }, payDay: 25 });
  expect(parsed.unused).toEqual([]);
  expect(parsed.shareCents).toBe(2050);
  expect(draftCircle(`${text} No short shares, and ${day}.`, "2026-11-05").circle!.payDay).toBe(25);
  expect(draftCircle(`${text} No short shares, and ${day}.`, "2026-11-05").circle!.rotation.every((slot) => slot.date.endsWith("-25"))).toBe(true);
});

it.each([", and ", "; ", " but ", " y ", " et "])("keeps an unknown clause after %s", (separator) => {
  const parsed = parseCircleText(`${text} No short shares${separator}bring snacks.`, "2026-11-05");
  expect(parsed.unused).toEqual(["bring snacks."]);
});

it.each([0, 29, 125, 2.5])("leaves invalid pay day %s unused", (day) => {
  const parsed = parseCircleText(`No short shares, and day ${day}.`, "2026-11-05");
  expect(parsed.rules).not.toHaveProperty("payDay");
  expect(parsed.unused).toEqual([`day ${day}.`]);
});

it("keeps confirmer names together without swallowing the next clause", () => {
  const parsed = parseCircleText(`${text} Ana and Ben confirm payouts, and bring snacks.`, "2026-11-05");
  expect(parsed.unused).toEqual(["bring snacks."]);
});

it("stores unmet needs through rules edits and Start, with pay day validation", async () => {
  const sb = sandbox();
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => sb.fetchFn(input as any, init));
  const c = draftCircle(`${text} Ana needs February. Ben needs February.`, "2026-11-05").circle!;
  const stub = env.CIRCLE.get(env.CIRCLE.idFromName(c.id));
  await stub.create(c);
  const state = async () => {
    const response = await worker.fetch(new Request(`https://ck.test/api/circles/${c.id}/state?k=${c.organiserToken}`), env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    return (await response.json() as any).circle;
  };
  const draft = await state();
  expect(draft.brokenNeeds).toHaveLength(1);
  expect(["Ana needs February", "Ben needs February"]).toContain(draft.brokenNeeds[0]);
  const update = (payDay: unknown, k = c.organiserToken) => worker.fetch(new Request(`https://ck.test/api/circles/${c.id}/rules`, { method: "POST", body: JSON.stringify({ k, rules: { ...c.rules, payDay } }) }), env, {} as ExecutionContext);
  expect((await update(25, c.members[0].token)).status).toBe(403);
  for (const invalid of [0, 29, 2.5, "25", null]) expect((await update(invalid)).status).toBe(400);
  expect((await update(25)).status).toBe(200);
  const rotation = draft.rotation.map((slot: any) => ({ ...slot, date: `${slot.month}-25` }));
  expect(await state()).toMatchObject({ payDay: 25, brokenNeeds: draft.brokenNeeds, rotation });
  expect((await stub.start("https://ck.test", c.organiserToken)).status).toBe(200);
  const active = await state();
  expect(active).toMatchObject({ status: "active", payDay: 25, brokenNeeds: draft.brokenNeeds, rotation });
  expect((await update(20)).status).toBe(409);
  const summary = rulesSummary(active).join(" ");
  expect(summary).toContain("Pay day: 25");
  expect(summary).toContain("Needs we could not meet:");
  expect(summary).toContain(draft.brokenNeeds[0]);
});

it("preserves the demo pay day and rotation", () => {
  const c = draftCircle(DEMO_TEXT, "2026-11-05", { demo: true, startMonth: DEMO_START_MONTH }).circle!;
  expect(c.payDay).toBe(15);
  expect(c.rotation.map((slot) => [slot.memberId, slot.month])).toEqual([
    ["marisol", "2026-12"], ["sam", "2027-01"], ["keisha", "2027-02"],
    ["theo", "2027-03"], ["amelie", "2027-04"], ["dana", "2027-05"],
  ]);
});
