import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";
// @ts-ignore shared capture helper
import { lateMember } from "../dev/late-member.mjs";
// @ts-ignore shared board mapping
import { toProjectData } from "../public/js/bryntum-data.js";

test.use({ trace: "off" });

for (const answer of ["yes", "no"] as const) test(`missed share: confirmers say ${answer}`, async ({ page, context, request }) => {
  const demo = await makeDemo(request);
  const k = new URL(demo.organiserUrl, "http://local").searchParams.get("k")!;
  const read = () => state(request, demo.id, k);
  await page.goto(demo.organiserUrl);
  await page.getByRole("button", { name: "Start the circle" }).click();
  const before = await waitFor(async () => { const s = await read(); return s.rounds[0].shares.length === s.circle.members.length && s; }, 120000);
  const late = lateMember(before, 1);
  for (const m of before.circle.members.filter((m: any) => m.id !== late)) {
    const response = await request.post(`/api/circles/${demo.id}/shares/1/${m.id}/cash`, { data: { k } });
    expect(response.ok()).toBe(true);
  }
  const denied = await request.post(`/api/circles/${demo.id}/missed/check`, { data: { k: demo.memberUrl(late).split("/").pop() } });
  expect(denied.status()).toBe(403);
  await page.getByRole("button", { name: "Skip to the due date" }).click();
  const asked = await waitFor(async () => { const s = await read(); return s.missed.some((m: any) => m.status === "asked") && s; }, 60000);
  const missed = asked.missed.find((m: any) => m.status === "asked");
  expect(missed.plan.action).toBe("move_to_end");
  expect(toProjectData(asked).events.find((e: any) => e.id === `share-1-${late}-0`).colorKey).toBe("late");
  await expect.poll(() => page.evaluate((id) => {
    const bar = document.querySelector(`[data-event-id="share-1-${id}-0"]`);
    const sample = document.createElement("span");
    sample.style.color = "var(--c-late)";
    document.documentElement.appendChild(sample);
    const color = getComputedStyle(sample).color;
    sample.remove();
    return !!bar && [bar, ...bar.querySelectorAll("*")].some((node) => getComputedStyle(node).backgroundColor === color);
  }, late)).toBe(true);
  await page.locator("#schedule .b-grid-headers").last().evaluate((e) => e.scrollTo({ left: e.scrollWidth }));
  await expect(page.locator('[data-event-id^="ghost-missed-"]').first()).toBeVisible();
  for (const id of before.circle.rules.confirmers) {
    const member = await context.newPage();
    await member.goto(demo.memberUrl(id));
    await expect(member.locator("#pending")).toContainText(before.circle.members.find((m: any) => m.id === late).name);
    await member.locator("#pending").getByRole("button", { name: answer === "yes" ? /^(Yes|Sí|Oui)$/ : /^(No|Non)$/ }).click();
    if (answer === "no") break;
    if (id === before.circle.rules.confirmers[0]) expect((await read()).circle.rotation).toEqual(before.circle.rotation);
  }
  const after = await waitFor(async () => { const s = await read(); return s.missed.find((m: any) => m.id === missed.id)?.status === (answer === "yes" ? "applied" : "declined") && s; }, 60000);
  await expect(page.locator('[data-event-id^="ghost-missed-"]')).toHaveCount(0);
  if (answer === "no") expect(after.circle.rotation).toEqual(before.circle.rotation);
  else {
    for (const turn of missed.plan.turns) expect(after.circle.rotation.find((s: any) => s.round === turn.round).memberId).toBe(turn.memberId);
    await expect(page.locator("#changes")).toContainText("The confirmers agreed.");
    for (const turn of missed.plan.turns) {
      const pot = page.locator(`[data-event-id="pot-${turn.round}"]`).first();
      await expect(pot).toHaveAttribute("data-resource-id", turn.memberId);
    }
  }
});
