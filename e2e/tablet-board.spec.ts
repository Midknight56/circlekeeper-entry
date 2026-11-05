import { expect, test } from "@playwright/test";
import { makeDemo } from "./helpers";

for (const width of [768, 1280]) {
  test(`the schedule stays readable at ${width} px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    const demo = await makeDemo(request);
    const k = new URL(demo.organiserUrl, "http://x").searchParams.get("k") || "";
    expect((await request.post(`/api/circles/${demo.id}/start`, { data: { k } })).ok()).toBe(true);
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 768) {
      const timeline = page.locator("#schedule .b-grid-sub-grid-normal");
      expect(await timeline.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const start = await page.locator("#schedule").getAttribute("data-start-date");
      const expected = new Date(start!);
      expected.setMonth(expected.getMonth() + 1);
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.locator("#schedule")).toHaveAttribute("data-start-date", expected.toISOString());
      await page.waitForTimeout(2500);
      await expect(page.locator("#schedule")).toHaveAttribute("data-start-date", expected.toISOString());
      await page.getByRole("button", { name: "Previous month", exact: true }).click();
      await expect(page.locator("#schedule")).toHaveAttribute("data-start-date", start!);
    } else {
      await expect(page.getByRole("button", { name: "Next month", exact: true })).toHaveCount(0);
      for (const amount of ["$100.00", "$600.00"]) {
        const chip = events.filter({ hasText: amount }).first();
        await expect(chip).toBeVisible();
        expect(await chip.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
        // The event itself must also contain the label, even if content overflow is visible.
        expect(await chip.evaluate((element) => element.scrollWidth <= element.closest(".b-sch-event")!.clientWidth)).toBe(true);
      }
    }
  });
}
