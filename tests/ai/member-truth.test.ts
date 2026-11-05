import { describe, expect, it } from "vitest";
import * as drop from "../../src/ai/drop";
import { TOOLS } from "../../src/ai/tools";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const names = ["Theo", "Sam"];
const check = (text: string, data: unknown, speakerName?: string) => drop.applyDropRule(
  [{ to: "member:theo", text, refs: ["c"] }], { c: data }, names, { speakerName },
);

describe("one member's money and status", () => {
  const data = { people: [{ name: "Theo", status: "UNPAID", paidCents: 0 }, { name: "Sam", status: "PAID", paidCents: 10000 }] };

  it("drops Theo borrowing Sam's paid amount and keeps Sam's own claim", () => {
    expect(check("Theo has paid $100.", data).kept).toEqual([]);
    expect(check("Sam has paid $100.", data).kept).toHaveLength(1);
  });

  it("ties money and status to you in the member's own chat", () => {
    expect(check("You have paid $100.", data, "Theo").kept).toEqual([]);
    expect(check("You have paid $100.", data, "Sam").kept).toHaveLength(1);
  });

  it("requires all tokens in the same record for that member", () => {
    const split = [{ name: "Theo", status: "PAID" }, { name: "Theo", amountCents: 10000 }, { name: "Sam", status: "UNPAID" }];
    expect(check("Theo has paid $100.", split).kept).toEqual([]);
  });

  it("keeps an unpaid claim with a repeated name beside another paid member", () => {
    expect(check("Theo has not paid yet, so Theo needs a reminder.", data).kept).toHaveLength(1);
  });

  it("backs the paid amount in the round's member record", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const share = await w.store.get<any>("share:01:sam");
    w.sb.payInvoice(share.parts[0].invoiceId);
    w.setNow("2026-12-01T15:02:00Z");
    const result = await TOOLS.find((t) => t.name === "get_round")!.run(w.ctx, { role: "organiser" }, { round: 1 });
    expect(check("Sam has paid $100.", result).kept).toHaveLength(1);
    expect(check("Theo has paid $100.", result).kept).toEqual([]);
  });

  it("backs a member's share and turn together from the circle view", async () => {
    const w = await world();
    const result = await TOOLS.find((t) => t.name === "get_circle")!.run(w.ctx, { role: "member", memberId: "keisha" }, {});
    const checked = drop.applyDropRule([{ to: "member:keisha", text: "Your share is $100 and your turn is in February 2027.", refs: ["c"] }], { c: result }, w.circle.members.map((m) => m.name), { speakerName: "Keisha" });
    expect(checked.kept).toHaveLength(1);
  });

  it("backs the pending swap status with the named member and month", async () => {
    const w = await world();
    const result = await TOOLS.find((t) => t.name === "propose_swap")!.run(w.ctx, { role: "member", memberId: "dana" }, { from_member: "dana", to_member: "theo" });
    const checked = drop.applyDropRule([{ to: "member:dana", text: "Your swap with Theo for March is pending.", refs: ["c"] }], { c: result }, w.circle.members.map((m) => m.name), { speakerName: "Dana" });
    expect(checked.kept).toHaveLength(1);
  });

  it.each(["OVERDUE", "RECEIVED", "CANCELLED", "SENT", "PENDING"])("ties %s to its own member", (status) => {
    const records = [{ name: "Theo", status: "UNPAID" }, { name: "Sam", status }];
    expect(check(`Theo is ${status.toLowerCase()}.`, records).kept).toEqual([]);
    expect(check(`Sam is ${status.toLowerCase()}.`, records).kept).toHaveLength(1);
  });

  it.each(["Theo has not paid yet.", "Theo hasn't paid.", "Theo has not yet paid.", "Theo no ha pagado.", "Theo no ha pagado todavía.", "Theo n'a pas payé.", "Theo n’a pas encore payé."])("checks unpaid meaning: %s", (text) => {
    expect(check(text, { name: "Theo", status: "UNPAID" }).kept).toHaveLength(1);
    for (const status of ["PAID", "MARKED_AS_PAID", "RECEIVED"]) {
      expect(check(text, { name: "Theo", status }).kept).toEqual([]);
    }
  });

  it("uses numeric paid totals for positive and negative claims", () => {
    for (const key of ["paidCents", "paidInCents", "paidIn"]) {
      expect(check("Theo has not paid yet.", { name: "Theo", [key]: 0 }).kept).toHaveLength(1);
      expect(check("Theo has not paid yet.", { name: "Theo", [key]: 100 }).kept).toEqual([]);
      expect(check("Theo has paid.", { name: "Theo", [key]: 100 }).kept).toHaveLength(1);
      expect(check("Theo has paid.", { name: "Theo", [key]: 0 }).kept).toEqual([]);
    }
  });

  it("backs the recorded departure sentence only before Theo pays", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const tool = TOOLS.find((t) => t.name === "preview_what_if")!;
    const text = "Theo has not paid yet, so the circle needs to agree how to settle this.";
    const args = { kind: "leave", member: "theo", month: "2027-03" };
    let result = await tool.run(w.ctx, { role: "organiser" }, args);
    expect(check(text, result).kept).toHaveLength(1);
    expect(result.people).toEqual([{ memberId: "theo", name: "Theo", paidInCents: 0, receivedCents: 0 }]);
    const share = await w.store.get<any>("share:01:theo");
    share.parts[0].status = "PAID";
    await w.store.put("share:01:theo", share);
    result = await tool.run(w.ctx, { role: "organiser" }, args);
    expect(check(text, result).kept).toEqual([]);
    expect(String(result.money)).toContain("has paid in $100.00");
  });
});

describe("unpaid claim detection", () => {
  it("recognises English, Spanish and French negation and close forms", () => {
    for (const text of ["has not paid", "hasn't paid", "hasn’t paid", "not paid yet", "not yet paid", "never paid", "no ha pagado", "no han pagado", "no pagó", "n'a pas payé", "n’a pas encore payé", "ne paie pas"]) {
      expect(drop.isUnpaidClaim(text), text).toBe(true);
    }
    for (const text of ["has paid", "ha pagado", "a payé", "not received", "not cancelled", "no reminder for a paid share"]) {
      expect(drop.isUnpaidClaim(text), text).toBe(false);
    }
  });
});
