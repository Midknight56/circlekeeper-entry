import { expect, test } from "@playwright/test";
import { state, waitFor } from "./helpers";

const keyFrom = (url: string) => new URL(url, "http://local").searchParams.get("k") || "";

test("a visitor makes their own circle from plain words", async ({ page, request }) => {
  await page.goto("/");
  await page.locator("#description").fill("4 of us: Ana, Ben, Cleo and Dev. $20 a month from January. Cleo needs the pot in March.");
  await page.getByRole("button", { name: "Make it" }).click();

  const result = page.locator("#result");
  await expect(result.getByRole("link", { name: "Open your board" })).toBeVisible();
  await expect(result.locator(".member-link-row")).toHaveCount(4);
  const boardUrl = await result.getByRole("link", { name: "Open your board" }).getAttribute("href");
  if (!boardUrl) throw new Error("The organiser board link was missing");

  await result.getByRole("link", { name: "Open your board" }).click();
  await expect(page.locator("h1")).toContainText("Our circle");
  // One row per member, in the Bryntum board or in the basic view it falls back to.
  await expect(page.locator("#schedule[data-view]")).toBeVisible();
  const rows = (await page.locator("#schedule").getAttribute("data-view")) === "bryntum"
    ? page.locator('#schedule [role="rowgroup"]').first().locator('[role="row"]')
    : page.locator("#schedule table tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#chat")).toContainText("Here is the rotation:");

  await page.getByRole("button", { name: "Start the circle" }).click();
  const board = new URL(boardUrl, "http://local");
  const current = await waitFor(async () => {
    const snapshot = await state(request, board.pathname.split("/").filter(Boolean).pop() || "", keyFrom(boardUrl));
    const round = snapshot.rounds.find((item: any) => item.round === 1);
    return round?.shares.length === 4 && round.shares.every((share: any) => share.parts?.some((part: any) => part.invoiceId)) ? snapshot : false;
  }, 60000);
  const round = current.rounds.find((item: any) => item.round === 1);
  expect(round.shares).toHaveLength(4);
  expect(round.shares.every((share: any) => share.parts.some((part: any) => part.invoiceId))).toBe(true);
});

test("an empty description is refused on the page", async ({ page }) => {
  await page.goto("/");
  const originalUrl = page.url();
  await page.getByRole("button", { name: "Make it" }).click();
  await expect(page.locator("#result")).toContainText("Describe your circle first.");
  await expect(page).toHaveURL(originalUrl);
});

test("a circle needs at least two members", async ({ page }) => {
  await page.goto("/");
  await page.locator("#description").fill("Just me, $10 a month");
  await page.getByRole("button", { name: "Make it" }).click();
  await expect(page.locator("#result")).toContainText("A circle needs at least 2 members.");
});
