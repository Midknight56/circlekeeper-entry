import { describe, expect, it } from "vitest";
import * as drop from "../../src/ai/drop";

const check = (text: string, data: unknown) => drop.applyDropRule(
  [{ to: "organiser", text, refs: ["c"] }], { c: data }, ["Sam", "Theo"],
);

describe("member claims and direction", () => {
  it("requires a paid record for every named member", () => {
    const data = [{ name: "Sam", status: "PAID", paidCents: 10000 }, { name: "Theo", status: "UNPAID", paidCents: 0 }];
    expect(check("Theo and Sam have paid $100.", data).kept).toEqual([]);
    expect(check("Sam has paid $100.", data).kept).toHaveLength(1);
  });

  it.each(["and", ",", "y", "et"])("pairs separate amounts by clause: %s", (join) => {
    const data = [{ name: "Sam", parts: [{ cents: 10000, status: "PAID" }] }, { name: "Theo", parts: [{ cents: 6000, status: "PAID" }] }];
    expect(check(`Sam paid $100 ${join} Theo paid $60.`, data).kept).toHaveLength(1);
    const bad = check(`Sam paid $60 ${join} Theo paid $100.`, data);
    expect(bad.kept).toEqual([]);
    expect(bad.dropped[0].clause).toContain("Sam paid $60");
  });

  it.each(["Sam has received $100.", "Sam got the pot of $100.", "Sam recibió $100.", "Sam ha recibido $100.", "Sam a reçu $100.", "Sam recevait $100."])("requires incoming money: %s", (text) => {
    const share = { name: "Sam", parts: [{ cents: 10000, status: "PAID" }] };
    expect(check(text, [share]).kept).toEqual([]);
    expect(check(text, [share, { recipient: { name: "Sam" }, potStatus: "paid", potCents: 10000 }]).kept).toHaveLength(1);
    expect(check(text, { name: "Sam", receivedCents: 10000 }).kept).toHaveLength(1);
    expect(check(text, [share, { recipient: { name: "Theo" }, potStatus: "paid", potCents: 10000 }]).kept).toEqual([]);
  });

  it("a paid pot never backs a paid share claim", () => {
    expect(check("Sam has paid $100.", { recipient: { name: "Sam" }, potStatus: "paid", potCents: 10000 }).kept).toEqual([]);
  });

  it("takes the incoming amount and status from the pot alone", () => {
    const share = { name: "Sam", status: "PAID", paidCents: 10000 };
    expect(check("Sam received $100.", { recipient: { name: "Sam" }, potStatus: "waiting", potCents: 10000, shares: [share] }).kept).toEqual([]);
    expect(check("Sam received $100.", { recipient: { name: "Sam" }, potStatus: "paid", potCents: 60000, shares: [share] }).kept).toEqual([]);
    expect(check("Sam received $100.", { name: "Sam", receivedCents: 6000, paidCents: 10000 }).kept).toEqual([]);
  });

  it("checks shared claims for all names and falls back when a clause has no name", () => {
    const data = [{ name: "Sam", status: "PAID", paidCents: 10000 }, { name: "Theo", status: "PAID", paidCents: 10000 }];
    expect(check("Sam and Theo paid $100.", data).kept).toHaveLength(1);
    expect(check("Sam paid $100 and Theo paid $100, with $60 due.", data).kept).toEqual([]);
  });

  it("exports direction detection for all three languages", () => {
    for (const text of ["received", "got the pot", "recibió", "ha recibido", "a reçu", "recevait"]) {
      expect(drop.claimDirection(text), text).toBe("received");
    }
    for (const text of ["has paid", "ha pagado", "a payé"]) expect(drop.claimDirection(text), text).toBe("paid");
    expect(drop.claimDirection("hello")).toBeUndefined();
  });
});
