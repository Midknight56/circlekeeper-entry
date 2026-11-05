import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/ai/tools";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const tool = TOOLS.find((t) => t.name === "preview_what_if")!;
const organiser = { role: "organiser" as const };

describe("the what if tool", () => {
  it("refuses a leave with no member, and names the members so the treasurer can ask again", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const r = await tool.run(w.ctx, organiser, { kind: "leave", month: "2027-03" });
    expect(r).toMatchObject({ ok: false });
    expect(String((r as any).error)).toMatch(/member is required for leave: .*Theo/);
    expect(await w.store.get("whatif:current")).toBeUndefined();
  });

  it("refuses a month that is not YYYY-MM", async () => {
    const w = await world();
    await startCircle(w.ctx);
    expect(await tool.run(w.ctx, organiser, { kind: "leave", member: "Theo", month: "March" })).toMatchObject({ ok: false, error: "month is required, as YYYY-MM" });
  });

  it("takes a member by name and returns the change lines the treasurer may quote", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const r = (await tool.run(w.ctx, organiser, { kind: "leave", member: "theo", month: "2027-03" })) as any;
    expect(r.ok).toBe(true);
    expect(r.status).toBe("PREVIEW ONLY");
    expect(r.changes[0]).toContain("Theo leaves in March 2027");
    expect(await w.store.get("whatif:current")).toBeTruthy();
  });
});
