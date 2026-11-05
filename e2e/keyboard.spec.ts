import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";

const organiserKey = (url: string) => new URL(url, "http://local").searchParams.get("k") || "";

async function tabTo(page: import("@playwright/test").Page, name: string) {
  const focused: string[] = [];
  for (let press = 0; press < 40; press++) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return "";
      const aria = element.getAttribute("aria-label");
      const text = element.textContent?.trim();
      return aria || text || element.tagName.toLowerCase();
    });
    focused.push(current);
    if (await page.evaluate((target) => {
      const element = document.activeElement;
      return element instanceof HTMLButtonElement && element.getAttribute("aria-label") === target ||
        element instanceof HTMLButtonElement && element.textContent?.trim() === target;
    }, name)) return;
  }
  throw new Error(`Could not reach ${name} by Tab. Focused elements: ${focused.join(", ")}`);
}

test("the board works by keyboard", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const key = organiserKey(demo.organiserUrl);
  await page.goto(demo.organiserUrl);
  await tabTo(page, "Start the circle");
  await page.keyboard.press("Enter");
  await waitFor(async () => {
    const current = await state(request, demo.id, key);
    return current.rounds.find((round: any) => round.round === 1)?.shares.length === 6;
  }, 60000);
});

test("a member can answer the treasurer by keyboard", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const key = organiserKey(demo.organiserUrl);
  // A short share needs an invoice to split: start the circle first.
  expect((await request.post(`/api/circles/${demo.id}/start`, { data: { k: key } })).status()).toBe(200);
  await page.goto(demo.memberUrl("marisol"));
  await page.waitForSelector("#member-name:not(:empty)");
  await tabTo(page, "Solo tengo 60 esta semana.");
  await page.keyboard.press("Enter");

  const yes = page.locator("#pending").getByRole("button", { name: "Sí" });
  await expect(yes).toBeVisible();
  await tabTo(page, "Sí");
  await page.keyboard.press("Enter");
  await waitFor(async () => {
    const current = await state(request, demo.id, key);
    const share = current.rounds.find((round: any) => round.round === 1)?.shares.find((item: any) => item.memberId === "marisol");
    return share?.parts?.filter((part: any) => part.status !== "CANCELLED").length === 2;
  }, 60000);
});

test("focus is visible", async ({ page, request }) => {
  const demo = await makeDemo(request);
  await page.goto(demo.organiserUrl);
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).not.toBe("0px");
});
