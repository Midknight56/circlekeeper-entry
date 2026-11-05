import { expect, test } from "@playwright/test";
import { makeDemo, measure } from "./helpers";

// Every control fits its margin on phones: 16 px inside the screen, text inside the button, 12 px or more between
// neighbours, nothing overlapping. A failure names the control.
const WIDTHS = [360, 390, 412];

for (const width of WIDTHS) {
  test(`every control fits at ${width} px`, async ({ browser, request }) => {
    const demo = await makeDemo(request);
    const k = new URL(demo.organiserUrl, "http://x").searchParams.get("k") || "";
    await request.post(`/api/circles/${demo.id}/start`, { data: { k } });
    await request.post(`/api/circles/${demo.id}/chat`, { data: { k: new URL(demo.memberUrl("marisol"), "http://x").pathname.split("/").pop(), text: "Solo tengo 60 esta semana." } });
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const all: string[] = [];
    for (const url of ["/", demo.organiserUrl, demo.memberUrl("marisol"), demo.memberUrl("theo"), demo.memberUrl("amelie")]) {
      await page.goto(url);
      await page.waitForTimeout(2500);
      for (const p of await measure(page)) all.push(`${url.split("?")[0]}: ${p}`);
    }
    await page.close();
    expect(all, all.join("\n")).toEqual([]);
  });

  test(`member rows keep one line at ${width} px`, async ({ browser, request }) => {
    const demo = await makeDemo(request);
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(demo.organiserUrl);
    await page.getByRole("button", { name: "Start the circle" }).click();
    await expect(page.locator('#round .controls button:has-text("Record cash")')).toHaveCount(6, { timeout: 120000 });

    const rows = await page.locator("#round .controls").evaluateAll((elements) => elements.map((element) => {
      const row = element as HTMLElement;
      const who = row.querySelector<HTMLElement>(".who")!;
      const button = row.querySelector<HTMLElement>("button")!;
      const rowRect = row.getBoundingClientRect();
      const whoRect = who.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        name: who.textContent?.trim() || "unknown member",
        overlapsVertically: buttonRect.top < whoRect.bottom && buttonRect.bottom > whoRect.top,
        height: rowRect.height,
      };
    }));
    for (const row of rows) {
      expect(row.overlapsVertically, `${row.name}: Record cash should share a line with the name`).toBe(true);
      expect(row.height, `${row.name}: row should be 64 px high or less`).toBeLessThanOrEqual(64);
    }
    await page.close();
  });
}

test("a long name lets Record cash wrap and stay inside", async ({ browser, request }) => {
  const demo = await makeDemo(request);
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.goto(demo.organiserUrl);
  await page.getByRole("button", { name: "Start the circle" }).click();
  await expect(page.locator('#round .controls button:has-text("Record cash")')).toHaveCount(6, { timeout: 120000 });

  const layout = await page.locator("#round .controls").first().evaluate((element) => {
    const row = element as HTMLElement;
    row.querySelector<HTMLElement>(".who")!.textContent = "Maximiliano Fernandez Rodriguez";
    const button = row.querySelector<HTMLElement>("button")!;
    const rowRect = row.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      buttonInsideRow: buttonRect.left >= rowRect.left && buttonRect.right <= rowRect.right && buttonRect.top >= rowRect.top && buttonRect.bottom <= rowRect.bottom,
      rowRight: rowRect.right,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.buttonInsideRow, "Record cash should stay inside the member row").toBe(true);
  expect(layout.rowRight, "member row should stay inside the window").toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.scrollWidth, "page should not scroll sideways").toBeLessThanOrEqual(layout.viewportWidth);
  await page.close();
});
