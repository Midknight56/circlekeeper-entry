import { describe, expect, it } from "vitest";
// @ts-ignore plain JavaScript module shared with the pages
import { chooseView } from "../../public/js/schedule-loader.js";

describe("schedule view selection", () => {
  it("falls back when the package cannot load in auto mode", () => expect(chooseView("auto", false)).toBe("basic"));
  it("uses Bryntum when available in auto mode", () => expect(chooseView("auto", true)).toBe("bryntum"));
  it("keeps basic when requested", () => expect(chooseView("basic", true)).toBe("basic"));
  it("falls back when a requested Bryntum package fails", () => expect(chooseView("bryntum", false)).toBe("basic"));
});
