import { expect, test } from "@playwright/test";
import { makeDemo } from "./helpers";

test("organiser sees the next action first on the board", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const k = new URL(demo.organiserUrl, "http://x").searchParams.get("k") || "";
  const started = await request.post(`/api/circles/${demo.id}/start`, { data: { k } });
  expect(started.ok()).toBe(true);

  for (const [width, height, screenshotPath] of [
    [1440, 900, "test-results/organiser-round-overview-1440.png"],
    [390, 844, "test-results/organiser-round-overview-390.png"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(demo.organiserUrl);

    const nextTitle = page.locator(".next-title");
    await expect(nextTitle).toBeVisible();
    await expect(nextTitle).toContainText("Waiting for 6 shares");

    const inViewport = await nextTitle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(inViewport, `next-title is visible in viewport at ${width}x${height}`).toBe(true);

    const logBody = page.locator("#log-body");
    await expect(logBody).toBeHidden();

    await page.screenshot({ path: screenshotPath });

    const logCard = page.locator("#log-card");
    await logCard.getByRole("button", { name: "Show activity" }).click();
    await expect(logBody).toBeVisible();
  }
});
