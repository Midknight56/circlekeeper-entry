import { mkdirSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { makeDemo } from "./helpers";

mkdirSync("shots", { recursive: true });

async function expectCalendarGeometry(calendar: Locator, card: Locator, kinds = ["share", "pot"]) {
  const calendarBox = await calendar.boundingBox();
  const cardBox = await card.boundingBox();
  if (!calendarBox || !cardBox) throw new Error("Calendar or card has no visible bounding box");

  for (const kind of kinds) {
    const event = calendar.locator(`.ck-member-event-${kind}`).first();
    await expect(event).toBeVisible();
    const box = await event.boundingBox();
    if (!box) throw new Error(`${kind} event has no visible bounding box`);
    expect(box.width).toBeGreaterThan(24);
    expect(box.x).toBeGreaterThanOrEqual(calendarBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(calendarBox.x + calendarBox.width);
    expect(box.y).toBeGreaterThanOrEqual(calendarBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(calendarBox.y + calendarBox.height);
  }

  const weeks = calendar.locator(".b-month-view .b-weeks-container .b-calendar-panel-row");
  await expect(weeks).toHaveCount(6);
  const lastWeek = await weeks.last().boundingBox();
  if (!lastWeek) throw new Error("Last month row has no visible bounding box");
  expect(lastWeek.y + lastWeek.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
}

async function expectAgendaGeometry(calendar: Locator) {
  await expect(calendar.locator(".b-month-view .b-day-cell:visible, .b-month-view .b-calendar-cell:visible")).toHaveCount(0);
  const labels = calendar.locator('.b-event-list .b-grid-row.ck-member-event [data-column="name"]');
  await expect(labels).not.toHaveCount(0);
  const clipped = await labels.evaluateAll((elements) => elements
    .filter((element) => element.scrollWidth > element.clientWidth)
    .map((element) => ({ text: element.textContent?.trim(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })));
  expect(clipped, JSON.stringify(clipped)).toEqual([]);
}

test("member pages show localized Bryntum dates with complete month geometry and basic fallback", async ({ request, page }) => {
  const demo = await makeDemo(request);
  const organizer = new URL(demo.organiserUrl, "http://x");
  await request.post(`/api/circles/${demo.id}/start`, { data: { k: organizer.searchParams.get("k") || "" } });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(demo.memberUrl("marisol"));
  const marisol = page.locator("#calendar-bryntum");
  const marisolCard = marisol.locator("xpath=..");
  const marisolModes = page.locator("#calendar-modes");
  await expect(marisol).toBeVisible();
  await expect(marisol.locator(".b-calendar")).toBeVisible();
  await expect(marisolModes.getByRole("button", { name: "Mes" })).toBeVisible();
  await expect(marisolModes.getByRole("button", { name: "Agenda" })).toBeVisible();
  await expect(marisol.locator('.b-calendar-toolbar [data-ref="viewDescription"]')).toContainText(/diciembre 2026/i);
  await expect(marisol.locator(".b-week-number-cell").first()).toBeHidden();
  await expect(marisol.locator(".b-week-num").first()).toBeHidden();
  await expectCalendarGeometry(marisol, marisolCard);
  await expect(marisol.locator(".ck-member-event-share")).toContainText("Por pagar");
  await expect(marisol.locator(".ck-member-event-pot")).toContainText("Tu turno");
  await marisolModes.getByRole("button", { name: "Mes" }).focus();
  await page.keyboard.press("Tab");
  await expect(marisolModes.getByRole("button", { name: "Agenda" })).toBeFocused();
  await marisolCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "shots/member-marisol-bryntum.png" });
  await marisolModes.getByRole("button", { name: "Agenda" }).click();
  await expect(marisol.locator(".b-event-list")).toContainText("Por pagar");
  await expect(marisol.locator(".b-event-list")).toContainText("Tu turno");
  await expectAgendaGeometry(marisol);
  await page.screenshot({ path: "shots/member-agenda-bryntum.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectAgendaGeometry(marisol);
  await page.screenshot({ path: "shots/member-agenda-bryntum-mobile.png" });
  await page.goto(demo.memberUrl("amelie"));
  const amelie = page.locator("#calendar-bryntum");
  const amelieCard = amelie.locator("xpath=..");
  const amelieModes = page.locator("#calendar-modes");
  await expect(amelie).toBeVisible();
  await expect(amelie.locator(".b-calendar")).toBeVisible();
  await expect(amelieModes.getByRole("button", { name: "Mois" })).toBeVisible();
  await expect(amelie.locator(".ck-member-event-share")).toContainText("À payer");
  await expect(amelie.locator(".ck-member-event-pot")).toHaveCount(0);
  const initialMonth = amelie.locator('.b-calendar-toolbar [data-ref="viewDescription"]');
  await expect(initialMonth).toContainText(/décembre 2026/i);
  await expect(amelie.locator(".b-week-number-cell").first()).toBeHidden();
  await expect(amelie.locator(".b-week-num").first()).toBeHidden();
  await amelieCard.scrollIntoViewIfNeeded();
  await expectCalendarGeometry(amelie, amelieCard, ["share"]);
  await page.screenshot({ path: "shots/member-amelie-bryntum.png" });

  const next = amelie.locator('[data-ref="nextButton"]');
  for (let attempts = 0; attempts < 12; attempts++) {
    const shownMonth = (await initialMonth.innerText()).toLocaleLowerCase("fr");
    if (shownMonth.includes("avril 2027")) break;
    await next.click();
  }
  await expect(initialMonth).toContainText(/avril 2027/i);
  await expect(amelie.locator(".ck-member-event-pot")).toBeVisible();
  await expect(amelie.locator(".ck-member-event-pot")).toContainText("Ton pot");
  await amelieCard.scrollIntoViewIfNeeded();
  await expectCalendarGeometry(amelie, amelieCard, ["pot"]);

  const basic = new URL(demo.memberUrl("marisol"), "http://x");
  basic.searchParams.set("calendar", "basic");
  await page.goto(basic.pathname + basic.search);
  await expect(page.locator("#calendar")).toBeVisible();
  await expect(page.locator("#calendar .member-calendar")).toBeVisible();
  await expect(page.locator("#calendar-bryntum")).toBeHidden();
});

test("the Bryntum calendar leaves the page Tab order in at most six presses", async ({ request, page }) => {
  const demo = await makeDemo(request);
  await page.goto(demo.memberUrl("marisol"));
  const agenda = page.locator("#calendar-modes").getByRole("button", { name: "Agenda" });
  await expect(agenda).toBeVisible();
  await agenda.focus();

  let leftCalendar = false;
  for (let press = 1; press <= 6; press++) {
    await page.keyboard.press("Tab");
    leftCalendar = await page.evaluate(() => {
      const active = document.activeElement;
      return !active || !document.querySelector("#calendar-modes")?.closest(".card")?.contains(active);
    });
    if (leftCalendar) break;
  }
  expect(leftCalendar).toBe(true);
});
