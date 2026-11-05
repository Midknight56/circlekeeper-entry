import { describe, expect, it } from "vitest";
import { localeFiles, toBryntumEvents } from "../../public/js/member-calendar-bryntum.js";
import type { MemberCalendarRow } from "../../public/js/member-calendar-bryntum.js";

const labels = { shareDue: "Share due", potDay: "Your pot", paid: "paid" };

describe("member Bryntum calendar mapping", () => {
  it("maps only the selected member's share and pot rows to dated events", () => {
    const rows: MemberCalendarRow[] = [
      { id: "1-a", memberId: "marisol", kind: "share", date: "2026-12-10", amount: "$100", status: "PAID" },
      { id: "1", memberId: "marisol", kind: "pot", date: "2026-12-15", amount: "$600", status: "ready" },
      { id: "2-b", memberId: "amelie", kind: "share", date: "2027-01-10", amount: "$100", status: "UNPAID" },
    ];

    const events = toBryntumEvents(rows, "marisol", "es", labels);
    expect(events).toHaveLength(2);
    expect(events.map(({ kind, startDate }) => [kind, startDate])).toEqual([
      ["share", "2026-12-10T00:00:00"],
      ["pot", "2026-12-15T00:00:00"],
    ]);
    expect(events[0]).toMatchObject({ name: "$100 · paid", paid: true, allDay: true });
    expect(events[1]).toMatchObject({ name: "Your pot · $600", paid: false, kind: "pot" });
  });

  it("maps supported languages to their shipped locale module names", () => {
    expect(localeFiles.en).toBe("calendar.locale.En.js");
    expect(localeFiles.es).toBe("calendar.locale.Es.js");
    expect(localeFiles.fr).toBe("calendar.locale.FrFr.js");
  });
});
