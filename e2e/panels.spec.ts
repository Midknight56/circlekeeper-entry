import { expect, test } from "@playwright/test";
import { makeDemo, measure } from "./helpers";

test("organiser can run the guard panel and inspect webhook activity", async ({ page, request }) => {
  test.setTimeout(90_000);
  const demo = await makeDemo(request);
  const k = new URL(demo.organiserUrl, "http://x").searchParams.get("k") || "";
  await request.post(`/api/circles/${demo.id}/start`, { data: { k } });
  const guard = page.locator("section[aria-labelledby='guard-title']");
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(demo.organiserUrl);
    await guard.getByRole("button", { name: "Show checks" }).click();
    const guardResponse = page.waitForResponse((response) => response.url().endsWith(`/api/circles/${demo.id}/guard`));
    await guard.getByRole("button", { name: "Run the three isolated checks" }).click();
    expect((await (await guardResponse).json()).rows).toHaveLength(3);
    await expect(guard.locator("#guard-results article")).toHaveCount(3);
    expect(await measure(page), `guard panel at ${width}px`).toEqual([]);
  }
  await expect(guard).toContainText("PayPal writes: 0");
  await guard.screenshot({ path: "test-results/guard-panel.png" });

  const activity = page.locator("section").filter({ has: page.getByRole("heading", { name: "Activity" }) });
  await activity.getByRole("button", { name: "Show activity" }).click();
  await activity.getByRole("button", { name: "Webhooks" }).click();
  await expect(activity.locator("#log")).toContainText("No webhooks yet");
  await activity.screenshot({ path: "test-results/webhooks-panel.png" });
});
