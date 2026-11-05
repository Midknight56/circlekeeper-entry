import { expect, test, type Locator } from "@playwright/test";
import { makeDemo, state } from "./helpers";

async function settledBox(locator: Locator, potName: string) {
  // The body follows the header's scroll a moment later, so an early box read is where the bar was.
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect.poll(async () => {
    box = await locator.evaluate(async (element) => {
      const first = element.getBoundingClientRect();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const second = element.getBoundingClientRect();
      const hit = document.elementFromPoint(second.x + second.width / 2, second.y + second.height / 2);
      if (first.x !== second.x || first.y !== second.y || first.width !== second.width || first.height !== second.height || !hit || !element.contains(hit)) return null;
      return { x: second.x, y: second.y, width: second.width, height: second.height };
    });
    return box !== null;
  }, { message: `${potName}'s pot box settles under the pointer` }).toBe(true);
  return box as { x: number; y: number; width: number; height: number } | null;
}

test("the organiser board uses the Scheduler Pro view at phone width", async ({ page, request }) => {
  const demo = await makeDemo(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(demo.organiserUrl);
  const startButton = page.getByRole("button", { name: "Start the circle" });
  let startButtonIsReachable = false;
  for (let index = 0; index < 30; index++) {
    if (await startButton.evaluate((element) => element === document.activeElement)) {
      startButtonIsReachable = true;
      break;
    }
    await page.keyboard.press("Tab");
  }
  expect(startButtonIsReachable).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startButton.click();
  await expect(page.locator("#schedule")).toHaveAttribute("data-view", "bryntum");
  await expect(page.locator('#schedule [role="rowgroup"]').first().locator('[role="row"]')).toHaveCount(6);
  await expect(page.locator('#schedule [data-event-id^="pot-"]').first()).toBeAttached();
  await expect(page.locator("#schedule .b-sch-dependency").first()).toBeAttached();

  const schedule = page.locator("#schedule");
  const scheduleBox = await schedule.boundingBox();
  expect(scheduleBox).not.toBeNull();
  const resourceRows = page.locator('#schedule [role="rowgroup"]').first().locator('[role="row"]');
  for (const row of await resourceRows.all()) {
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(scheduleBox!.x);
    expect(box!.y).toBeGreaterThanOrEqual(scheduleBox!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(scheduleBox!.x + scheduleBox!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(scheduleBox!.y + scheduleBox!.height);
  }

  const eventElements = page.locator('#schedule [data-event-id^="share-"], #schedule [data-event-id^="pot-"]');
  const eventBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const event of await eventElements.all()) {
    const id = await event.getAttribute("data-event-id");
    const box = await event.boundingBox();
    expect(id).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box!.width, `${id} width`).toBeGreaterThan(24);
    expect(box!.height, `${id} height`).toBeGreaterThan(12);
    eventBoxes.set(id!, box!);
  }
  for (const pot of await page.locator('#schedule [data-event-id^="pot-"]').all()) {
    const id = (await pot.getAttribute("data-event-id"))!;
    const round = id.slice("pot-".length);
    const potBox = eventBoxes.get(id)!;
    for (const [shareId, shareBox] of eventBoxes) {
      if (shareId.startsWith(`share-${round}-`)) expect(potBox.x).toBeGreaterThanOrEqual(shareBox.x + shareBox.width);
    }
  }

  const decHeader = page.locator('#schedule .b-sch-header-time-axis-cell').filter({ hasText: /Dec\s*2026|December\s*2026/i }).first();
  await expect(decHeader).toBeAttached();
  const decBox = await decHeader.boundingBox();
  expect(decBox).not.toBeNull();
  for (const [shareId, shareBox] of eventBoxes) {
    if (shareId.startsWith("share-1-")) {
      expect(shareBox.x).toBeGreaterThanOrEqual(decBox!.x);
      expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(decBox!.x + decBox!.width);
    }
  }

  const timeAxisScroller = page.locator("#schedule .b-grid-headers").last();
  await timeAxisScroller.evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: "instant" }));
  const mayHeader = page.locator('#schedule .b-sch-header-time-axis-cell').filter({ hasText: /May\s*2027|May\s*,?\s*2027/i }).first();
  await expect(mayHeader).toBeAttached();
  await timeAxisScroller.evaluate((element) => element.scrollTo({ left: 0, behavior: "instant" }));

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileScheduleBox = await schedule.boundingBox();
  expect(mobileScheduleBox).not.toBeNull();
  const currentRoundBars = [...eventBoxes].filter(([id]) => id.startsWith("share-1-"));
  expect(currentRoundBars.some(([, box]) => box.x < mobileScheduleBox!.x + mobileScheduleBox!.width && box.x + box.width > mobileScheduleBox!.x)).toBe(true);
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("dragging Dana's pot asks Dana and Theo and shows a temporary proposal", async ({ page, context, request }) => {
  const demo = await makeDemo(request);
  await page.goto(demo.organiserUrl);
  await page.getByRole("button", { name: "Start the circle" }).click();
  await expect(page.locator("#schedule")).toHaveAttribute("data-view", "bryntum");
  const organiserKey = new URL(demo.organiserUrl, "http://local").searchParams.get("k")!;
  const before = await state(request, demo.id, organiserKey);
  const danaRound = before.circle.rotation.find((slot: any) => slot.memberId === "dana").round;
  const theoRound = before.circle.rotation.find((slot: any) => slot.memberId === "theo").round;
  const timeAxisScroller = page.locator("#schedule .b-grid-headers").last();
  await timeAxisScroller.evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: "instant" }));
  // The header moves first and the body follows it a moment later.
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("#schedule .b-grid-headers-normal");
    if (!header || header.scrollLeft <= 0) return false;
    return Array.from(document.querySelectorAll<HTMLElement>("#schedule .b-widget-scroller.b-horizontal-overflow"))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .every((element) => Math.round(element.scrollLeft) === Math.round(header.scrollLeft));
  }), { message: "horizontal overflow scrollers follow the header scroll position" }).toBe(true);
  const source = page.locator(`#schedule [data-event-id="pot-${danaRound}"]`);
  await expect(source).toBeVisible();
  const originalBox = await settledBox(source, "Dana");
  expect(originalBox).not.toBeNull();
  const target = page.locator(`#schedule [data-event-id="pot-${theoRound}"]`);
  await expect(target).toBeVisible();
  const targetBox = await settledBox(target, "Theo");
  expect(targetBox).not.toBeNull();
  const scheduleTop = async () => (await page.locator("#schedule").boundingBox())!.y;
  const theoRowY = targetBox!.y - (await scheduleTop()); // Theo's row, measured from the schedule box
  const x = originalBox!.x + originalBox!.width / 2;
  const startY = originalBox!.y + originalBox!.height / 2;
  const endX = targetBox!.x + targetBox!.width / 2;
  const endY = targetBox!.y + targetBox!.height / 2;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.waitForTimeout(100);
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(x + ((endX - x) * step) / 12, startY + ((endY - startY) * step) / 12);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();

  await expect(page.locator("#notice")).toHaveText("Asked Dana and Theo. Nothing moves until both say yes.", { timeout: 30000 });
  const afterAsk = await state(request, demo.id, organiserKey);
  expect(afterAsk.circle.rotation.find((slot: any) => slot.memberId === "dana").round).toBe(danaRound);
  expect(afterAsk.circle.rotation.find((slot: any) => slot.memberId === "theo").round).toBe(theoRound);
  const ghosts = page.locator('#schedule [data-event-id^="ghost-"]');
  await expect(ghosts).toHaveCount(2, { timeout: 20000 });
  console.log("Ghost rendering", await ghosts.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { className: element.className, x: box.x, y: box.y, width: box.width, height: box.height, border: style.border, opacity: style.opacity };
  })));
  await page.screenshot({ path: "test-results/board-swap-ghost.png", fullPage: true });

  const dana = await context.newPage();
  await dana.goto(demo.memberUrl("dana"));
  const theo = await context.newPage();
  await theo.goto(demo.memberUrl("theo"));
  await dana.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ }).click();
  const unchanged = await state(request, demo.id, organiserKey);
  expect(unchanged.circle.rotation.find((slot: any) => slot.memberId === "dana").round).toBe(danaRound);
  await theo.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ }).click();

  await expect.poll(async () => {
    const current = await state(request, demo.id, organiserKey);
    return current.circle.rotation.find((slot: any) => slot.memberId === "dana").round;
  }).toBe(theoRound);
  await expect.poll(async () => {
    const box = await page.locator(`#schedule [data-event-id="pot-${danaRound}"]`).boundingBox();
    return box ? Math.round(box.y - (await scheduleTop())) : null;
  }).toBe(Math.round(theoRowY)); // Dana's old pot now sits on Theo's row
  await expect(page.locator('#schedule [data-event-id^="ghost-"]')).toHaveCount(0);
});
