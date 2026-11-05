import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";

const organiserKey = (url: string) => new URL(url, "http://local").searchParams.get("k") || "";

test("Marisol's share links to the PayPal sandbox invoice", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const key = organiserKey(demo.organiserUrl);

  expect((await request.post(`/api/circles/${demo.id}/start`, { data: { k: key } })).status()).toBe(200);
  await waitFor(async () => {
    const current = await state(request, demo.id, key);
    return current.rounds.find((round: any) => round.round === 1)?.shares.length === 6;
  }, 60000);

  await page.goto(demo.memberUrl("marisol"));
  const payLink = page.getByRole("link", { name: "Pagar en PayPal", exact: true });
  let lastReload = Date.now();
  await waitFor(async () => {
    if (Date.now() - lastReload >= 10000) {
      await page.reload();
      lastReload = Date.now();
    }
    return await payLink.isVisible() ? payLink : false;
  }, 60000);

  const href = await payLink.getAttribute("href");
  expect(href).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);
  expect(await payLink.getAttribute("target")).toBe("_blank");

  await page.goto(demo.memberUrl("sam"));
  // Wait for Sam's own pay link, so the check below runs on a drawn page.
  const samLink = page.getByRole("link", { name: "Pay on PayPal", exact: true });
  await waitFor(async () => {
    if (!(await samLink.isVisible())) await page.reload();
    return (await samLink.isVisible()) ? samLink : false;
  }, 60000);
  expect(await samLink.getAttribute("href")).not.toBe(href);
  const samHasMarisolLink = await page.locator("a").evaluateAll(
    (links, marisolHref) => links.some((link) => (link as HTMLAnchorElement).href === marisolHref),
    href,
  );
  expect(samHasMarisolLink).toBe(false);
});
