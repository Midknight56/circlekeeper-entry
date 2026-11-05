import { describe, expect, it } from "vitest";
import { monthGrid } from "../../public/js/member-calendar.js";

describe("member month calendar", () => {
  it("starts December 2026 on Tuesday and places dates on their calendar days", () => {
    const result = monthGrid([
      { date: "2026-12-10", kind: "share", paid: false, label: "Share due" },
      { date: "2026-12-15", kind: "pot", paid: false, label: "Your pot" },
    ], "2026-12", "en");

    expect(result.weeks[0][0]).toEqual({ day: null, date: null, marks: [] });
    expect(result.weeks[0][1]).toEqual({ day: 1, date: "2026-12-01", marks: [] });
    expect(result.weeks[1][3]).toEqual({
      day: 10,
      date: "2026-12-10",
      marks: [{ kind: "share", paid: false, label: "Share due" }],
    });
    expect(result.weeks[2][1]).toEqual({
      day: 15,
      date: "2026-12-15",
      marks: [{ kind: "pot", paid: false, label: "Your pot" }],
    });
  });

  it("localizes weekday names and the month title", () => {
    const dates = [{ date: "2026-12-10", kind: "share" as const, paid: false, label: "Due" }];
    const french = monthGrid(dates, "2026-12", "fr");
    const spanish = monthGrid(dates, "2026-12", "es");

    expect(french.weekdays).toHaveLength(7);
    expect(french.weekdays[0].toLocaleLowerCase("fr")).toMatch(/^lun/);
    expect(french.weekdays[3].toLocaleLowerCase("fr")).toMatch(/^jeu/);
    expect(spanish.title.toLocaleLowerCase("es")).toContain("diciembre");
    expect(spanish.title).toContain("2026");
  });
});
