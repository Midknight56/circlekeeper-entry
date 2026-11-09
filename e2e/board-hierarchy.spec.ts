import { expect, test } from "@playwright/test";
import { makeDemo } from "./helpers";

test("rules sit under the next action in a draft circle", async ({ page, request }) => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    const demo = await makeDemo(request);
    await page.goto(demo.organiserUrl);

    const nextTitle = page.locator(".next-title");
    await expect(nextTitle).toBeVisible();
    await expect(nextTitle).toHaveText("Review the rules, then Start");

    const payDay = page.getByText("Pay day").locator("visible=true").first();
    await expect(payDay).toBeVisible();
    const payDayBox = await payDay.boundingBox();
    expect(payDayBox).not.toBeNull();
    expect(payDayBox!.y).toBeGreaterThanOrEqual(0);
    expect(payDayBox!.y).toBeLessThan(height);

    const visibleRules = page.locator("#rules-card, #draft-rules").locator("visible=true").first();
    await expect(visibleRules).toBeVisible();
    const heading = visibleRules.getByRole("heading", { name: /^(Rules|Circle terms and rules)$/ });
    await expect(heading).toBeVisible();
  }
});

test("the desktop schedule shows every turn", async ({ page, request }) => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    const demo = await makeDemo(request);
    await page.goto(demo.organiserUrl);

    await expect(page.locator("#schedule")).toHaveAttribute("data-view", "bryntum");
    const potChips = page.locator('#schedule [data-event-id^="pot-"]');
    await expect(potChips).toHaveCount(6);

    // The visible part of the time axis: a chip past its right edge is cut off on screen.
    const visibleAxis = await page.locator("#schedule .b-grid-headers-normal").boundingBox();
    expect(visibleAxis).not.toBeNull();
    const axisRight = visibleAxis!.x + visibleAxis!.width;

    for (const pot of await potChips.all()) {
      const potBox = await pot.boundingBox();
      expect(potBox).not.toBeNull();
      expect(potBox!.x).toBeGreaterThanOrEqual(visibleAxis!.x);
      expect(potBox!.x + potBox!.width).toBeLessThanOrEqual(axisRight + 1);

      const content = pot.locator(".b-sch-event-content");
      const { scrollWidth, clientWidth } = await content.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
  }
});

test("record cash is a quiet fallback", async ({ page, request }) => {
  const demo = await makeDemo(request);
  await page.goto(demo.organiserUrl);

  await page.getByRole("button", { name: "Start the circle" }).click();

  const recordCash = page.getByRole("button", { name: "Record cash" }).first();
  await expect(recordCash).toBeVisible();

  const cashStyles = await recordCash.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderTopWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(cashStyles.borderTopWidth).toBe("0px");
  expect(cashStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");

  const openPageButton = page.locator('#round-strip [class*="button"]').filter({ hasText: /^Open .*'s page$/ }).first();
  await expect(openPageButton).toBeVisible();
  const openPageBorder = await openPageButton.evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth));
  expect(openPageBorder).toBeGreaterThan(0);
});
