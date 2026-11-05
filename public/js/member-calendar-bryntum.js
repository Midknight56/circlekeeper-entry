export const localeFiles = {
  en: "calendar.locale.En.js",
  es: "calendar.locale.Es.js",
  fr: "calendar.locale.FrFr.js",
};
const localeNames = { en: "En", es: "Es", fr: "FrFr" };

const PAID = new Set(["PAID", "MARKED_AS_PAID", "COMPLETED"]);

function makeMonthGridKeyboardAccessible(container) {
  const selector = ".b-month-view";
  const update = () => {
    const grid = container.querySelector(selector);
    if (!grid) return;

    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", grid.getAttribute("aria-label") || "Calendar month");
    grid.tabIndex = 0;
    for (const element of container.querySelectorAll(".b-calendar button, .b-calendar [tabindex], .b-calendar a")) {
      if (!element.matches('[data-ref="prevButton"], [data-ref="nextButton"]')) element.tabIndex = -1;
    }
    for (const button of container.querySelectorAll('.b-calendar [data-ref="prevButton"], .b-calendar [data-ref="nextButton"]')) button.tabIndex = 0;
    for (const cell of grid.querySelectorAll(".b-day-cell")) {
      cell.tabIndex = -1;
      cell.setAttribute("role", "gridcell");
      const day = cell.querySelector(".b-day-name-date, .b-day-number, .b-day-cell-date")?.textContent?.trim();
      if (day && !cell.hasAttribute("aria-label")) cell.setAttribute("aria-label", day);
    }
    for (const event of grid.querySelectorAll(".ck-member-event")) {
      event.tabIndex = -1;
      const label = event.textContent?.trim();
      if (label) event.setAttribute("aria-label", label);
    }
  };

  container.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLElement) || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const grid = event.target.closest(selector);
    if (!grid) return;
    const cells = [...grid.querySelectorAll(".b-day-cell")];
    if (!cells.length) return;
    const activeEvent = event.target.closest(".ck-member-event");
    const activeCell = event.target.closest(".b-day-cell") || grid;
    const cellIndex = Math.max(0, cells.indexOf(activeCell));
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : 7;

    if (activeEvent) {
      const events = [...activeEvent.closest(".b-day-cell").querySelectorAll(".ck-member-event")];
      const eventIndex = events.indexOf(activeEvent);
      const nextEvent = events[eventIndex + step];
      if (nextEvent) {
        event.preventDefault();
        nextEvent.focus();
        return;
      }
    }

    const nextCell = cells[Math.max(0, Math.min(cells.length - 1, cellIndex + step))];
    if (nextCell) {
      event.preventDefault();
      const nextEvent = event.key === "ArrowDown" ? nextCell.querySelector(".ck-member-event") : null;
      (nextEvent || nextCell).focus();
    }
  });

  const observer = new MutationObserver(update);
  observer.observe(container, { childList: true, subtree: true });
  update();
}

export function toBryntumEvents(rows, memberId, lang, labels) {
  return rows
    .filter((row) => row.memberId === memberId && row.date && row.kind !== "cancelled")
    .map((row) => {
      const paid = row.kind === "share" ? PAID.has(row.status) : row.status === "paid";
      const next = new Date(`${row.date}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return {
        id: `member-${memberId}-${row.kind}-${row.id}`,
        name: row.kind === "pot"
          ? `${labels.potDay} · ${row.amount}`
          : `${row.amount} · ${paid ? labels.paid : labels.shareDue}`,
        startDate: `${row.date}T00:00:00`,
        endDate: `${next.toISOString().slice(0, 10)}T00:00:00`,
        allDay: true,
        kind: row.kind,
        paid,
        cls: `ck-member-event ck-member-event-${row.kind} ${paid ? "ck-member-event-paid" : "ck-member-event-open"}`,
      };
    });
}

export async function mountBryntumCalendar(container, rows, memberId, lang, labels, currentMonth) {
  const file = localeFiles[lang] || localeFiles.en;
  const localeName = localeNames[lang] || localeNames.en;
  const [module] = await Promise.all([
    import(/* @vite-ignore */ "/vendor/bryntum/calendar/calendar.module.js"),
    import(/* @vite-ignore */ `/vendor/bryntum/calendar/locales/${file}`),
  ]);
  const events = toBryntumEvents(rows, memberId, lang, labels);
  const dates = events.map((event) => event.startDate.slice(0, 10)).sort();
  const firstDate = dates[0] || (currentMonth ? `${currentMonth}-01` : new Date().toISOString().slice(0, 10));
  const lastDate = dates.at(-1) || firstDate;
  const rangeEnd = new Date(`${lastDate}T12:00:00Z`);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
  const rangeDays = Math.ceil((Date.parse(lastDate) - Date.parse(firstDate)) / 86400000) + 2;
  const calendar = new module.Calendar({
    appendTo: container,
    date: currentMonth ? `${currentMonth}-01` : undefined,
    mode: "month",
    modes: {
      month: { showWeekColumn: false, showWeekNumber: false, sixWeeks: true },
      list: {
        date: new Date(`${firstDate}T00:00:00`),
        range: `${rangeDays} days`,
        startDate: new Date(`${firstDate}T00:00:00`),
        endDate: new Date(`${rangeEnd.toISOString().slice(0, 10)}T00:00:00`),
        syncCalendarDate: false,
        columns: [
          { field: "startDate", width: 150 },
          { field: "name", flex: 1, minWidth: 0 },
          { field: "endDate", hidden: true },
          { field: "resources", hidden: true },
        ],
      },
      agenda: false, day: false, week: false, year: false,
      resource: false, dayresource: false, dayagenda: false, monthagenda: false,
      monthgrid: false, yearplanner: false,
    },
    sidebar: false,
    tbar: {
      items: {
        toggleSidebar: null,
        todayButton: null,
        prevButton: {},
        viewDescription: {},
        nextButton: {},
      },
    },
    events,
    autoCreate: false,
    readOnly: true,
    cls: "ck-member-calendar",
  });
  await calendar.localeManager.applyLocale(localeName);
  makeMonthGridKeyboardAccessible(container);
  return calendar;
}

export function updateBryntumEvents(calendar, rows, memberId, lang, labels) {
  calendar.eventStore.data = toBryntumEvents(rows, memberId, lang, labels);
}
