import { expect, test } from "@playwright/test";
import { makeDemo, measure, state, waitFor } from "./helpers";

test("a paid demo round has a receipt that checks out", async ({ page, context, request }) => {
  const demo = await makeDemo(request);
  await page.goto(demo.organiserUrl);
  const key = new URL(demo.organiserUrl, "http://local").searchParams.get("k") || "";
  const organiserState = () => state(request, demo.id, key);
  await page.getByRole("button", { name: "Start the circle" }).click();
  await waitFor(async () => (await organiserState()).rounds[0].shares.filter((s: any) => s.parts.some((p: any) => p.invoiceId)).length === 6, 120000);
  const members = (await organiserState()).circle.members;
  for (const { id: memberId, name } of members) {
    await page.locator("#round .controls").filter({ hasText: name }).getByRole("button", { name: "Record cash" }).click();
    await waitFor(async () => {
      const current = await organiserState();
      const share = current.rounds[0].shares.find((item: any) => item.memberId === memberId);
      return share?.parts.every((part: any) => ["PAID", "MARKED_AS_PAID", "COMPLETED"].includes(part.status));
    }, 60000);
  }
  await waitFor(async () => (await organiserState()).rounds[0].pot.status === "drafted", 120000);
  for (const memberId of ["dana", "theo"]) {
    const memberPage = await context.newPage();
    await memberPage.goto(demo.memberUrl(memberId));
    await memberPage.getByRole("button", { name: "Confirm the pot" }).click();
  }
  await waitFor(async () => (await organiserState()).rounds[0].pot.status === "paid", 200000);
  await page.reload();
  await page.getByRole("link", { name: "Round 1 receipt" }).click();
  await expect(page.locator("#delta")).toContainText("0.00");
  await page.getByRole("button", { name: "Check the book" }).click();
  await expect(page.locator("#result")).toHaveText("The book checks out");
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await measure(page), `receipt at ${width}px`).toEqual([]);
  }
  await page.screenshot({ path: "artifacts/receipt.png", fullPage: true });
});
