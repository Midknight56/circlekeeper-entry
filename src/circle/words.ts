import type { Need } from "./solver";
import type { Rules } from "./model";

export interface ParsedMember { name: string; lang: "en" | "es" | "fr" }
export interface ParsedNeed { name: string; kind: Need["kind"]; month: string; text: string }
export interface ParsedRules { payDay?: number; privacy?: boolean; shortShare?: Partial<Rules["shortShare"]>; missed?: Partial<Rules["missed"]> }
export interface ParsedCircle { count: number; members: ParsedMember[]; shareCents: number | null; startMonth: string | null; needs: ParsedNeed[]; notes: string[]; rules: ParsedRules; unused: string[] }

const monthNames: Record<string, number> = {
  january: 1, jan: 1, enero: 1, janvier: 1, janv: 1,
  february: 2, feb: 2, febrero: 2, février: 2, fevrier: 2, févr: 2, fevr: 2,
  march: 3, mar: 3, marzo: 3, mars: 3,
  april: 4, apr: 4, abril: 4, avril: 4,
  may: 5, mayo: 5, mai: 5,
  june: 6, jun: 6, junio: 6, juin: 6,
  july: 7, jul: 7, julio: 7, juillet: 7, juil: 7,
  august: 8, aug: 8, agosto: 8, août: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, septembre: 9,
  october: 10, oct: 10, octubre: 10, octobre: 10,
  november: 11, nov: 11, noviembre: 11, novembre: 11,
  december: 12, dec: 12, diciembre: 12, décembre: 12, decembre: 12,
};
const monthPattern = Object.keys(monthNames).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
const excludedNames = new Set(["i", "we", "you", "he", "she", "they", "it", "paypal", ...Object.keys(monthNames), "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function monthIndex(year: number, month: number): number { return year * 12 + month - 1; }
function formatMonth(index: number): string { return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`; }
function monthFor(name: string, pivot: number): number {
  const month = monthNames[name.toLocaleLowerCase()];
  let result = Math.floor(pivot / 12) * 12 + month - 1;
  if (result < pivot) result += 12;
  return result;
}
function titleName(value: string): string | null {
  const cleaned = value.trim().replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, "");
  if (!/^\p{Lu}[\p{L}'-]*$/u.test(cleaned) || excludedNames.has(cleaned.toLocaleLowerCase())) return null;
  return cleaned;
}
function namesInList(value: string): string[] {
  const pieces = value.replace(/\b(?:and|y|et)\b/gi, ",").split(/,|\n/);
  return pieces.map(titleName).filter((name): name is string => name !== null);
}

export function slugId(name: string, taken: Set<string>): string {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export function parseCircleText(text: string, today: string): ParsedCircle {
  const normalized = text.replace(/\r/g, "");
  const countMatch = /\b(?:(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+of\s+us|we\s+are\s+(\d{1,2})(?:\s+(?:friends|people|members))?|(\d{1,2})\s+(?:people|members))\b/i.exec(normalized);
  let count = countMatch ? Number(countMatch[1] ?? countMatch[2] ?? countMatch[3]) || numberWords[(countMatch[1] ?? "").toLowerCase()] || 0 : 0;
  const found: string[] = [];
  const add = (name: string) => { if (!found.includes(name)) found.push(name); };
  for (const match of normalized.matchAll(/\b([A-ZÀ-ÖØ-Þ][\p{L}'’-]*)\s+(?:needs|wants|can't|cannot)\b/gu)) {
    const name = titleName(match[1]!); if (name) add(name);
  }
  for (const match of normalized.matchAll(/\b(?:with|members\s*:|us\s*:|we\s+are\s+\d{1,2}\s+(?:friends|people|members)\s*:)\s*([^.!?\n;]+)/gi)) {
    namesInList(match[1]!.replace(/^\d+\s+of\s+/i, "")).forEach(add);
  }
  const leadingList = /^\s*([^.!?\n;]+?)(?:\.|\n|;|$)/.exec(normalized)?.[1];
  if (leadingList && /,/.test(leadingList)) namesInList(leadingList.replace(/^\d+\s+of\s+us\s*,?\s*/i, "")).forEach(add);
  found.sort((a, b) => normalized.indexOf(a) - normalized.indexOf(b));
  if (count < found.length) count = found.length;
  if (count === 0 && found.length) count = found.length;
  const members: ParsedMember[] = found.map((name) => ({ name, lang: "en" }));
  const langRules = [
    { regex: /\b([A-ZÀ-ÖØ-Þ][\p{L}'’-]*)\s+speaks\s+Spanish\b/giu, lang: "es" as const },
    { regex: /\b([A-ZÀ-ÖØ-Þ][\p{L}'’-]*)\s+(?:speaks\s+)?French\b/giu, lang: "fr" as const },
    { regex: /\b([A-ZÀ-ÖØ-Þ][\p{L}'’-]*)\s+in\s+Spanish\b/giu, lang: "es" as const },
    { regex: /\b([A-ZÀ-ÖØ-Þ][\p{L}'’-]*)\s+in\s+French\b/giu, lang: "fr" as const },
  ];
  for (const rule of langRules) for (const match of normalized.matchAll(rule.regex)) {
    const member = members.find((item) => item.name === match[1]); if (member) member.lang = rule.lang;
  }
  for (const match of normalized.matchAll(/\b([A-ZÀ-ÖØ-Þ][\p{L}'’-]*)\s*\((Spanish|French)\)/giu)) {
    const member = members.find((item) => item.name === match[1]); if (member) member.lang = match[2]!.toLowerCase() === "spanish" ? "es" : "fr";
  }
  while (members.length < count) members.push({ name: `Member ${members.length + 1}`, lang: "en" });

  const money = /\$\s*(\d+(?:\.\d{1,2})?)\b|\b(\d+(?:\.\d{1,2})?)\s*(?:dollars?|a\s+month|each)\b/i.exec(normalized);
  const amount = money ? Number(money[1] ?? money[2]) : NaN;
  const shareCents = Number.isFinite(amount) ? Math.round(amount * 100) : null;
  const todayParts = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  const todayIndex = todayParts ? monthIndex(Number(todayParts[1]), Number(todayParts[2])) : 0;
  let startMonth: string | null = null;
  if (/\bnext\s+month\b/i.test(normalized)) startMonth = formatMonth(todayIndex + 1);
  else {
    const startMatch = new RegExp(`\\b(?:from|starting(?:\\s+in)?|begins(?:\\s+in)?)\\s+(${monthPattern})\\b`, "i").exec(normalized);
    if (startMatch) startMonth = formatMonth(monthFor(startMatch[1]!, todayIndex));
  }
  const spanStart = startMonth ? Number(startMonth.slice(0, 4)) * 12 + Number(startMonth.slice(5)) - 1 : todayIndex + 1;
  const memberNames = new Set(found);
  const needs: ParsedNeed[] = [];
  const needRegex = new RegExp(`([^.!?\\n;]*?)\\b(${Array.from(memberNames).map(escapeRegExp).join("|")})\\b([^.!?\\n;]*?)(?:\\b(${monthPattern})\\b)`, "giu");
  if (found.length) for (const match of normalized.matchAll(needRegex)) {
    const before = match[1] ?? ""; const name = match[2]!; const after = match[3] ?? ""; const monthName = match[4]!;
    const clause = `${before}${name}${after}${monthName}`.trim().replace(/^[,\s]+|[,\s]+$/g, "");
    const lower = clause.toLocaleLowerCase();
    let kind: Need["kind"] = "want";
    let month = monthFor(monthName, spanStart);
    if (/\b(?:can't|cannot|not\s+[^,]*|avoid)\b/.test(lower) || /\bcan't\s+(?:take|do)\b/.test(lower) || /\bcannot\s+have\b/.test(lower)) kind = "avoid";
    if (/\bbefore\b/.test(lower)) { kind = "on_or_before"; month--; }
    else if (/\b(?:by|no\s+later\s+than)\b/.test(lower)) kind = "on_or_before";
    else if (/\bafter\b/.test(lower)) { kind = "on_or_after"; month++; }
    else if (/\bor\s+later\b|\bfrom\s+[^ ]+\s+on\b/.test(lower)) kind = "on_or_after";
    needs.push({ name, kind, month: formatMonth(month), text: clause });
  }
  const notes: string[] = [];
  if (!count) notes.push("how many members?");
  if (shareCents === null) notes.push("no share amount found");
  if (startMonth === null) notes.push("no start month found");
  const rules: ParsedRules = {};
  const unused: string[] = [];
  // A decimal point is part of an amount, not a sentence boundary. Keep the original punctuation in unused text.
  const sentences = normalized.match(/(?:\.(?=\d)|[^.!?;\n])+(?:[.!?;]+|$)/g) || [];
  const clauses = sentences.flatMap((raw) => {
    const list = raw.trim().replace(/[.!?;]+$/, "").replace(/^(?:\d+\s+of\s+us|members|us|we\s+are\s+\d{1,2}\s+(?:friends|people|members))\s*:\s*/i, "");
    // A member list and the names of two confirmers belong together.
    if (list.split(/,|\b(?:and|y|et)\b/i).every((part) => titleName(part))) return [raw];
    return raw.split(/,|\b(?:and(?!\s+[\p{L}'-]+\s+(?:confirm|approve|sign off)\b)|but|y|et)\b/iu).map((part) => part.trim()).filter(Boolean);
  });
  for (const raw of clauses) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const consumed = new Array<boolean>(sentence.length).fill(false);
    const mark = (match: RegExpExecArray | null) => {
      if (match) consumed.fill(true, match.index, match.index + match[0].length);
      return match;
    };
    const consume = (pattern: RegExp) => mark(pattern.exec(sentence));
    const payDay = /\b(?:pay\s+on\s+(?:the\s+)?|on\s+the\s+|day\s+)(\d+)(?:st|nd|rd|th)?(?![\d\p{L}]|\.\d)/iu.exec(sentence);
    if (payDay && Number(payDay[1]) >= 1 && Number(payDay[1]) <= 28) {
      rules.payDay = Number(payDay[1]); mark(payDay);
      const suffix = /^\s+of each month\b/i.exec(sentence.slice(payDay.index + payDay[0].length));
      if (suffix) consumed.fill(true, payDay.index + payDay[0].length, payDay.index + payDay[0].length + suffix[0].length);
    }
    if (consume(/\b(?:no short shares|no splitting|short shares (?:are )?not allowed|splitting (?:is )?not allowed)\b/i)) {
      rules.shortShare = { ...rules.shortShare, allowed: false };
    } else if (consume(/\b(?:(?:allow|allows) (?:short shares|splitting)|short shares (?:are )?allowed|splitting (?:is )?allowed)\b/i)) {
      rules.shortShare = { ...rules.shortShare, allowed: true };
    }
    if (consume(/\b(?:late shares (?:must )?wait|the pot waits)\b/i)) {
      rules.missed = { ...rules.missed, action: "pot_waits" };
    } else if (consume(/\bmove to the end\b/i)) {
      rules.missed = { ...rules.missed, action: "move_to_end" };
    }
    const grace = /\b(?:wait\s+)?(\d+) days? grace\b|\bwait (\d+) days?\b/i.exec(sentence);
    if (grace) { rules.missed = { ...rules.missed, graceDays: Number(grace[1] ?? grace[2]) }; mark(grace); }
    const privacy = /\bamounts (?:are )?(private|shared)\b/i.exec(sentence);
    if (privacy) { rules.privacy = privacy[1].toLowerCase() === "private"; mark(privacy); }
    if (countMatch) consume(new RegExp(escapeRegExp(countMatch[0]), "i"));
    if (money) {
      const amount = consume(new RegExp(escapeRegExp(money[0]) + "(?:\\s+(?:a|each|per)\\s+month)?", "i"));
      // A cadence is consumed only beside the amount that was actually read.
      if (amount) {
        consume(/\b(?:a|each|per) month\b/i);
        const contribution = /\beach\s+(?:person|member|one)(?:\s+of\s+us)?\s+(?:puts\s+in|pays(?:\s+in)?|gives)\s*$/i.exec(sentence.slice(0, amount.index));
        if (contribution) consumed.fill(true, contribution.index, amount.index);
      }
    }
    if (startMonth) consume(new RegExp(`\\b(?:next month|(?:from|starting(?:\\s+in)?|begins(?:\\s+in)?)\\s+(?:${monthPattern})(?:\\s+${startMonth.slice(0, 4)})?)\\b`, "i"));
    for (const member of members) {
      const name = escapeRegExp(member.name);
      consume(new RegExp(`\\b${name}\\s+(?:(?:speaks\\s+|in\\s+)(?:Spanish|French)|\\((?:Spanish|French)\\)|French)`, "iu"));
    }
    const knownNames = found.map(escapeRegExp).join("|");
    if (knownNames) {
      consume(new RegExp(`^(?:A savings circle\\s+)?with\\s+(?:${knownNames})(?:\\s*,\\s*(?:${knownNames}))*(?:\\s+and\\s+(?:${knownNames}))?\\b`, "u"));
      consume(new RegExp(`\\b(?:${knownNames})\\s+and\\s+(?:${knownNames})\\s+(?:confirm|approve|sign off)(?:\\s+payouts)?\\b`, "u"));
      for (const need of needs) {
        consume(new RegExp(`\\b${escapeRegExp(need.name)}\\s+(?:needs|wants|can't|cannot)\\s+(?:(?:the\\s+)?pot\\s+)?(?:(?:in|by|before|after|no later than|take|do|have|not)\\s+)*(?:${monthPattern})(?:\\s+or later)?\\b`, "iu"));
      }
    }
    const list = sentence.replace(/[.!?;]+$/, "").replace(/^(?:members|us|we\s+are\s+\d{1,2}\s+(?:friends|people|members))\s*:\s*/i, "");
    const withoutCount = list.replace(/^(?:\d+\s+of\s+us)\s*:\s*/i, "");
    if (namesInList(withoutCount).length && namesInList(withoutCount).every((name) => found.includes(name)) && withoutCount.split(/,|\b(?:and|y|et)\b/i).every((part) => titleName(part))) consumed.fill(true);
    let remainder = sentence.split("").map((char, i) => consumed[i] ? " " : char).join("");
    // Ignore only known filler; unread numbers and exception words must stay visible.
    if (knownNames) remainder = remainder.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${knownNames})(?![\\p{L}\\p{N}])`, "giu"), " ");
    remainder = remainder.replace(/\b(?:thank\s+you|hi|hello|hey|thanks|a|an|the|and|of|in|on|we|are|us)\b/gi, " ");
    if (/[\p{L}\p{N}]/u.test(remainder)) unused.push(sentence);
  }
  return { count, members, shareCents, startMonth, needs, notes, rules, unused };
}
