import { expect, it } from "vitest";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { applyDropRule, extractTokens, splitSentences } from "../../src/ai/drop";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

for (const date of ["December 25", "December 25th, 2026", "25 December 2026", "the 25th of December", "25 de diciembre de 2026", "25 décembre 2026", "December twenty fifth", "veinticinco de diciembre", "vingt cinq décembre"]) {
  it(`drops the wrong due day through the full turn: ${date}`, async () => {
    const w = await world();
    await startCircle(w.ctx);
    const text = `Your $100 share is due ${date}.`;
    const out = await runTurn(w.ctx, new RecordedModel([JSON.stringify({ say: [{ to: "member:sam", text, refs: ["call_1"] }] })]), { role: "member", memberId: "sam" }, "When is my share due?");
    expect(out.dropped).toBe(1);
    expect(out.said.map((s) => s.text)).not.toContain(text);
  });
}

const check = (date: string, dueDate = "2026-12-10", extra = {}) => applyDropRule(
  [{ to: "member:sam", text: `Your share is due ${date}.`, refs: ["r"] }],
  { r: { name: "Sam", dueDate, ...extra } }, ["Sam"], { speakerName: "Sam" },
);

it("keeps exact full dates and genuine month statements in three languages", () => {
  for (const date of ["December 10", "December 10th, 2026", "10 December 2026", "the tenth of December", "10 de diciembre de 2026", "diez de diciembre", "10 décembre 2026", "dix décembre", "December", "December 2026", "diciembre de 2026", "décembre 2026"]) {
    expect(check(date).kept, date).toHaveLength(1);
  }
});

it("uses the due date rather than a reminder, payment or pot date", () => {
  expect(check("December 25", "2026-12-10", { paidAt: "2026-12-25", potDate: "2026-12-25", lastReminder: "2026-12-25" }).kept).toEqual([]);
});

it("checks the year and rejects impossible calendar days", () => {
  for (const date of ["December 10, 2027", "December 10,2027", "February 30", "31 de abril", "31 avril", "February 29, 2027", "May first", "mai premier"]) expect(check(date).kept, date).toEqual([]);
  expect(check("February 29, 2028", "2028-02-29").kept).toHaveLength(1);
});

it("binds Spanish and French due expressions to the invoice date", () => {
  for (const text of ["Tu aportación vence el 25 de diciembre.", "Ta part est due le 25 décembre.", "Ta part a pour échéance le 25 décembre."]) {
    const result = applyDropRule([{ to: "member:sam", text, refs: ["r"] }], { r: { name: "Sam", dueDate: "2026-12-10", paidAt: "2026-12-25" } }, ["Sam"], { speakerName: "Sam" });
    expect(result.kept, text).toEqual([]);
  }
});

for (const [wrong, right] of [
  ["Dec. 25", "Dec. 10"],
  ["Dec. 25, 2026", "Dec. 10, 2026"],
  ["25 dic. de 2026", "10 dic. de 2026"],
  ["dic. 25 de 2026", "dic. 10 de 2026"],
  ["25 déc. 2026", "10 déc. 2026"],
  ["déc. 25 2026", "déc. 10 2026"],
]) {
  it(`checks dotted month dates through the full turn: ${wrong}`, async () => {
    const w = await world();
    await startCircle(w.ctx);
    for (const [date, dropped] of [[wrong, 1], [right, 0]] as const) {
      const text = `Your $100 share is due ${date}.`;
      const out = await runTurn(w.ctx, new RecordedModel([JSON.stringify({ say: [{ to: "member:sam", text, refs: ["call_1"] }] })]), { role: "member", memberId: "sam" }, "When is my share due?");
      expect(out.dropped, text).toBe(dropped);
      expect(out.said.some((s) => s.text === text), text).toBe(dropped === 0);
    }
  });
}

it("checks the optional year after a dotted month and retains sentence boundaries", () => {
  for (const date of ["Dec. 10, 2027", "10 dic. de 2027", "10 déc. 2027", "Dec. 32", "31 févr. 2026"]) {
    expect(check(date).kept, date).toEqual([]);
  }
  expect(splitSentences("Due Dec. 10. Thank you!")).toEqual(["Due Dec. 10.", "Thank you!"]);
  expect(splitSentences("Due in Dec. Thank you!")).toEqual(["Due in Dec.", "Thank you!"]);
  expect(extractTokens("Due Dec. 10, 2026.", []).filter((t) => t.kind === "date")).toEqual([
    { kind: "date", raw: "Dec. 10, 2026", value: "2026-12-10" },
  ]);
});

it("checks supported dotted month abbreviations in all three languages", () => {
  const months = [
    ["01", "Jan.", "ene.", "janv."], ["02", "Feb.", "feb.", "févr."],
    ["03", "Mar.", "mar.", "mars"], ["04", "Apr.", "abr.", "avr."],
    ["05", "May", "may.", "mai"], ["06", "Jun.", "jun.", "juin"],
    ["07", "Jul.", "jul.", "juil."], ["08", "Aug.", "ago.", "août"],
    ["09", "Sept.", "sept.", "sept."], ["10", "Oct.", "oct.", "oct."],
    ["11", "Nov.", "nov.", "nov."], ["12", "Dec.", "dic.", "déc."],
  ];
  for (const [mm, ...words] of months) for (const word of words) {
    for (const date of [`${word} 10, 2026`, `10 ${word} 2026`]) expect(check(date, `2026-${mm}-10`).kept, date).toHaveLength(1);
    for (const date of [`${word} 25, 2026`, `25 ${word} 2026`]) expect(check(date, `2026-${mm}-10`).kept, date).toEqual([]);
  }
});
