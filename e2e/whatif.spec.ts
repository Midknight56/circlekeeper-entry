import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";

test.use({ trace: "off" });

test("what if suggestion and join form preview without moving real pots", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const k = new URL(demo.organiserUrl, "http://local").searchParams.get("k")!;
  const read = () => state(request, demo.id, k);
  await page.goto(demo.organiserUrl);
  const before = await read();
  await page.getByRole("button", { name: "What if Theo leaves in March?", exact: true }).click();
  const preview = await waitFor(async () => { const s = await read(); return s.whatIf && s; }, 60000);
  await expect(page.locator('#schedule [data-event-id^="whatif-"]').first()).toBeVisible();
  for (const line of preview.whatIf.lines.en) await expect(page.locator("#whatif-lines")).toContainText(line);
  await expect(page.locator("#whatif-lines")).toContainText("March");
  await expect(page.locator("#chat")).toContainText("Theo");
  await expect(page.locator("#chat")).toContainText("the circle needs to agree how to settle this.");
  expect(preview.treasurer.recordedRun).toBe(true);
  expect(preview.circle.rotation).toEqual(before.circle.rotation);
  expect(preview.log.filter((e: any) => e.kind === "model").every((e: any) => e.recorded && e.neurons === 0)).toBe(true);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator('#schedule [data-event-id^="whatif-"]')).toHaveCount(0);
  await page.locator("#whatif-kind").selectOption("join");
  await page.locator("#whatif-name").fill("Robin");
  await page.locator("#whatif-form").getByRole("button", { name: "Preview", exact: true }).click();
  const joined = await waitFor(async () => { const s = await read(); return s.whatIf?.members.some((m: any) => m.name === "Robin") && s; }, 60000);
  const last = joined.whatIf.rotation.at(-1);
  expect(last.month > before.circle.rotation.at(-1).month).toBe(true);
  await page.locator("#schedule .b-grid-headers").last().evaluate((e) => e.scrollTo({ left: e.scrollWidth }));
  await expect(page.locator(`[data-event-id="whatif-pot-${last.round}"]`).first()).toBeVisible();
  await expect(page.locator("#whatif-lines")).toContainText("Robin joins");
  expect(joined.circle.rotation).toEqual(before.circle.rotation);
});

test("a member cannot preview and has no what if form", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const url = demo.memberUrl("dana");
  const response = await request.post(`/api/circles/${demo.id}/whatif`, { data: { k: url.split("/").pop(), change: { kind: "join", name: "Robin" } } });
  expect(response.status()).toBe(403);
  await page.goto(url);
  await expect(page.locator("#member-name")).toContainText("Dana");
  await expect(page.locator("#whatif-form")).toHaveCount(0);
});
