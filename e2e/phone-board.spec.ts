import { expect, test } from "@playwright/test";
import { makeDemo } from "./helpers";

test("the organiser board fits a phone and pages through months", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const demo = await makeDemo(request);
  const k = new URL(demo.organiserUrl, "http://x").searchParams.get("k") || "";
  const started = await request.post(`/api/circles/${demo.id}/start`, { data: { k } });
  expect(started.ok()).toBe(true);
  const memberKey = new URL(demo.memberUrl("marisol"), "http://x").pathname.split("/").pop();
  const proposed = await request.post(`/api/circles/${demo.id}/chat`, { data: { k: memberKey, text: "Solo tengo 60 esta semana." } });
  expect(proposed.ok()).toBe(true);
  await page.goto(demo.organiserUrl);

  const events = page.locator("#schedule .b-sch-event-content");
  const names = page.locator('#schedule .b-grid-cell[data-column="name"]');
  await expect(events.first()).toBeVisible();
  await expect(names.first()).toBeVisible();
  for (const cells of [events, names]) {
    const sizes = await cells.evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
  }

  const guard = page.locator("section[aria-labelledby='guard-title']");
  await expect(page.locator("#pending-card")).toBeVisible();
  const top = (selector: string) => page.locator(selector).evaluate((element) => element.getBoundingClientRect().top);
  const guardTop = await guard.evaluate((element) => element.getBoundingClientRect().top);
  for (const selector of ["#pending-card", "#chat"]) expect(await top(selector)).toBeLessThan(guardTop);

  const toggle = guard.locator('button[aria-controls="guard-body"]');
  await expect(toggle).toHaveText("Show checks");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(guard.getByRole("button", { name: "Run the three attacks" })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(guard.getByRole("button", { name: "Run the three attacks" })).toBeVisible();
  for (const [card, label, content] of [["#changes-card", "Show changes", "#changes"], ["#log-card", "Show activity", "#log-body"]]) {
    await expect(page.locator(content)).toBeHidden();
    await page.locator(card).getByRole("button", { name: label }).click();
    await expect(page.locator(content)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const timeline = page.locator("#schedule .b-grid-sub-grid-normal");
  expect(await timeline.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  const header = page.locator("#schedule .b-sch-header-time-axis-cell");
  await expect(header.first()).toBeVisible();
  const before = await header.allTextContents();
  const start = await page.locator("#schedule").getAttribute("data-start-date");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect.poll(() => header.allTextContents()).not.toEqual(before);
  const next = await page.locator("#schedule").getAttribute("data-start-date");
  const expected = new Date(start!);
  expected.setMonth(expected.getMonth() + 1);
  expect(next).toBe(expected.toISOString());
  // Polling updates must keep the month the organiser chose.
  await page.waitForTimeout(2500);
  await expect(page.locator("#schedule")).toHaveAttribute("data-start-date", next!);
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.locator("#schedule")).toHaveAttribute("data-start-date", start!);
  await expect.poll(() => header.allTextContents()).toEqual(before);
});
