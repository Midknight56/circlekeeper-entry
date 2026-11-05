import { describe, expect, it } from "vitest";
// @ts-ignore plain JavaScript module shared with the pages
import { toProjectData } from "../../public/js/bryntum-data.js";
import SAMPLE_JSON from "../../public/dev/sample-state.json";
const SAMPLE: any = SAMPLE_JSON;

describe("the Bryntum project data", () => {
  const now = "2026-12-08T12:00:00.000Z";
  const data = toProjectData({ ...SAMPLE, now });

  it("one resource per member, in order", () => {
    expect(data.resources.map((r: any) => r.id)).toEqual(SAMPLE.circle.members.map((m: any) => m.id));
  });

  it("one event per live share part and one pot event per round, each assigned to its member", () => {
    const shareParts = SAMPLE.rounds.flatMap((r: any) => r.shares.flatMap((s: any) => s.parts.filter((p: any) => p.status !== "CANCELLED")));
    expect(data.events.filter((e: any) => e.kind === "share")).toHaveLength(shareParts.length);
    expect(data.events.filter((e: any) => e.kind === "pot")).toHaveLength(SAMPLE.rounds.length);
    for (const a of data.assignments) {
      expect(data.events.some((e: any) => e.id === a.event)).toBe(true);
      expect(data.resources.some((r: any) => r.id === a.resource)).toBe(true);
    }
  });

  it("a finish to start dependency from every share event of a round to its pot", () => {
    for (const r of SAMPLE.rounds) {
      const pot = `pot-${r.round}`;
      const shares = data.events.filter((e: any) => e.kind === "share" && e.round === r.round).map((e: any) => e.id);
      const deps = data.dependencies.filter((d: any) => d.toEvent === pot).map((d: any) => d.fromEvent).sort();
      expect(deps).toEqual(shares.sort());
    }
    expect(data.dependencies.every((dependency: any) => dependency.type === 2)).toBe(true);
  });

  it("share bars keep a positive due-date window and identify paid status", () => {
    for (const e of data.events.filter((x: any) => x.kind === "share")) {
      const round = SAMPLE.rounds.find((r: any) => r.round === e.round);
      const share = round.shares.find((s: any) => s.memberId === e.memberId);
      const partIndex = Number(e.id.split("-").at(-1));
      const part = share.parts[partIndex];
      expect(Date.parse(e.startDate)).toBeLessThan(Date.parse(e.endDate));
      expect(e.endDate).toBe(`${part.dueDate || round.date}T12:00:00.000Z`);
      expect(e.duration).toBeGreaterThan(0);
      expect(e.manuallyScheduled).toBe(true);
      expect(e.paid).toBe(e.paidAt !== null);
    }
    for (const p of data.events.filter((x: any) => x.kind === "pot")) {
      const held = data.events.some((e: any) => e.kind === "share" && e.round === p.round && !e.paid);
      expect(p.held).toBe(held);
    }
  });
});
