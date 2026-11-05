import { expect, test } from "@playwright/test";
import { state } from "./helpers";

test("a member sees the circle rules and the off line before typing", async ({ page, request }) => {
  const response = await request.post("/api/circles", { data: { text: "Ana, Ben, Cleo, Dev. $20 each month from January 2027. No short shares." } });
  expect(response.ok()).toBe(true);
  const circle = await response.json();
  const k = new URL(circle.organiserUrl, "http://x").searchParams.get("k") || "";
  expect((await request.post(`/api/circles/${circle.id}/start`, { data: { k } })).ok()).toBe(true);
  const board = await state(request, circle.id, k);
  await page.goto(board.memberLinks.find((link: { memberId: string }) => link.memberId === "ana").url);
  await expect(page.locator("#member-actions")).toContainText("This circle does not split shares.");
  await expect(page.getByRole("button", { name: "Pay part now", exact: true })).toHaveCount(0);
  const off = page.getByText("Live answers are off on this site. Use the buttons above.", { exact: true });
  await expect(off).toBeVisible();
  await expect(page.locator("#chat-input")).toBeEmpty();
  const offBottom = await off.evaluate((element) => element.getBoundingClientRect().bottom);
  const inputTop = await page.locator("#chat-input").evaluate((element) => element.getBoundingClientRect().top);
  expect(offBottom).toBeLessThanOrEqual(inputTop);
});

test("an open checkout hides split and alternative payments", async ({ page, request }) => {
  const response = await request.post("/api/circles", { data: { text: "Ana, Ben, Cleo, Dev. $100 each month from January 2027." } });
  expect(response.ok()).toBe(true);
  const circle = await response.json();
  const k = new URL(circle.organiserUrl, "http://x").searchParams.get("k") || "";
  expect((await request.post(`/api/circles/${circle.id}/start`, { data: { k } })).ok()).toBe(true);
  const board = await state(request, circle.id, k);
  const link = board.memberLinks.find((entry: { memberId: string }) => entry.memberId === "ana").url;
  await page.goto(link);
  const memberKey = new URL(link, "http://x").pathname.split("/").at(-1);
  expect((await request.post(`/api/circles/${circle.id}/shares/1/ana/order`, { data: { k: memberKey } })).ok()).toBe(true);
  await page.reload();
  await expect(page.locator("#shares")).toContainText("Your checkout still needs to be checked. Do not pay again yet.");
  await expect(page.getByRole("button", { name: "Pay part now", exact: true })).toHaveCount(0);
  await expect(page.locator("#shares a")).toHaveCount(0);
  await expect(page.locator("#shares button")).toHaveCount(1);
  await expect(page.locator("#shares button")).toHaveText("Pay with PayPal checkout");
});
