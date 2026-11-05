import { writtenDate } from "./dates";
import type { FinancialFact } from "./facts";

export interface Say { to: string; text: string; refs: string[] }
export interface DropResult { kept: Say[]; dropped: { say: Say; sentence: string; token: string; clause?: string }[] }
export interface Token { negative?: boolean; kind: "money" | "date" | "name" | "status" | "pronoun"; raw: string; value: string }
export interface DropOptions { speakerName?: string }

const normalize = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const months: Record<string, string> = {};
const addMonths = (mm: string, words: string[]) => words.forEach((word) => { months[normalize(word)] = mm; });
addMonths("01", ["january", "jan", "enero", "ene", "janvier", "janv"]);
addMonths("02", ["february", "feb", "febrero", "fevrier", "fevr"]);
addMonths("03", ["march", "mar", "marzo", "mars"]);
addMonths("04", ["april", "apr", "abril", "abr", "avril", "avr"]);
addMonths("05", ["may", "mayo", "mai"]);
addMonths("06", ["june", "jun", "junio", "juin"]);
addMonths("07", ["july", "jul", "julio", "juillet", "juil"]);
addMonths("08", ["august", "aug", "agosto", "ago", "aout"]);
addMonths("09", ["september", "sep", "sept", "septiembre", "septembre"]);
addMonths("10", ["october", "oct", "octubre", "octobre"]);
addMonths("11", ["november", "nov", "noviembre", "novembre"]);
// Words that are also common verbs or words: only a date when a number sits next to them.
const AMBIGUOUS_MONTHS = new Set(["may", "mar", "mai"]);
addMonths("12", ["december", "dec", "diciembre", "dic", "decembre"]);

const statusMap: Record<string, string> = {};
const addStatus = (canonical: string, words: string[]) => words.forEach((word) => { statusMap[normalize(word)] = canonical; });
addStatus("PAID", ["paid", "pagado", "pagada", "pagó", "pagaste", "payé", "payée", "payés", "réglé"]);
addStatus("UNPAID", ["unpaid"]);
addStatus("UNPAID", ["ne paie pas", "ne paye pas", "ne paient pas"]);
addStatus("OVERDUE", ["overdue", "late", "atrasado", "atrasada", "en retard"]);
addStatus("CANCELLED", ["cancelled", "canceled", "cancelado", "cancelada", "annulé", "annulée"]);
addStatus("SENT", ["sent", "enviado", "envoyé"]);
addStatus("PENDING", ["pending", "pendiente", "en attente"]);
addStatus("CONFIRMED", ["confirmed"]);
addStatus("RECEIVED", ["received", "recibido", "reçu"]);
addStatus("PAID_OUT", ["paid out", "versé", "versée", "versés", "desembolsado", "desembolsada"]);
// A claim that a turn already moved: only true when a result says the swap was applied.
addStatus("APPLIED", ["swapped", "moved", "switched", "intercambiaron", "intercambiado", "cambiaron", "cambiado", "échangé", "échangés", "déplacé", "déplacés"]);

export function isUnpaidClaim(text: string): boolean {
  const plain = normalize(text).replace(/’/g, "'");
  return /\b(?:(?:not|never|hasn't|haven't|hadn't|isn't|wasn't)\s+(?:yet\s+)?paid|no\s+(?:(?:ha|han|he|has|habia)\s+)?(?:todavia\s+)?(?:pagad[oa]|pago)|(?:n'\s*(?:a|ont|ai|as|avait)|ne\s+\w+)\s+pas\s+(?:encore\s+)?paye[es]?|ne\s+pa(?:ie|ye|ient)\s+pas)\b/u.test(plain);
}

// Negation belongs to the financial predicate, not its amount or recipient.
function financialPolarity(text: string): "positive" | "negative" | "uncertain" {
  const plain = normalize(text).replace(/\u2019/g, "'");
  const negative = /\b(?:not|never|no|pas|unpaid)\b|\b\w+n't\b/u.test(plain);
  if (/\b(?:maybe|perhaps|possibly|might|may|quizas|peut|only|solo|seulement)\b/u.test(plain) ||
      negative && /\b(?:not|no|pas)\b.*\b(?:not|no|pas)\b/u.test(plain)) return "uncertain";
  return negative ? "negative" : "positive";
}

const RECEIVED_WORDS = /\b(?:receiv(?:e[ds]?|ing)|got\s+the\s+pot|recibi(?:o|do|da|eron|a)|recu[es]?|recev(?:ait|aient|ons|ez))\b/gu;

export function claimDirection(text: string): "received" | "paid" | undefined {
  const plain = normalize(text);
  if (new RegExp(RECEIVED_WORDS).test(plain)) return "received";
  if (/\b(?:paid|unpaid|pagad[oa]s?|pago|pagaste|paye[es]?|regle)\b/u.test(plain)) return "paid";
  return undefined;
}

function amountCents(raw: string): string | undefined {
  const cleaned = raw.replace(/\$/g, "").replace(/\b(?:USD|dollars?|dólares)\b/gi, "").trim();
  let number = cleaned.replace(/\s/g, "");
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(number)) number = number.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(number)) number = number.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(number)) number = number.replace(",", ".");
  const n = Number(number);
  return Number.isFinite(n) ? String(Math.round(n * 100)) : undefined;
}

export function extractTokens(sentence: string, memberNames: string[]): Token[] {
  const found: Array<Token & { start: number; end: number }> = [];
  const money = /(?:\bUSD\s*\d[\d.,]*|\$\s*\d[\d.,]*|\d[\d.,]*\s*(?:dollars?|dólares|USD|\$))|(?<![\w.,])\d+[.,]\d{1,2}(?![\w.,])/gi;
  for (const match of sentence.matchAll(money)) {
    const raw = match[0]; const value = amountCents(raw);
    if (value !== undefined) found.push({ kind: "money", raw, value, start: match.index!, end: match.index! + raw.length });
  }
  const iso = /\b\d{4}-\d{2}(?:-\d{2})?\b/g;
  for (const match of sentence.matchAll(iso)) found.push({ kind: "date", raw: match[0], value: match[0], start: match.index!, end: match.index! + match[0].length });
  const monthRegex = /\b[\p{L}]+\b/gu;
  for (const match of sentence.matchAll(monthRegex)) {
    const mm = months[normalize(match[0])]; if (!mm) continue;
    const index = match.index!; const contextual = AMBIGUOUS_MONTHS.has(normalize(match[0]));
    const date = writtenDate(sentence, index, match[0], mm);
    if (contextual && date.value === mm && !/\b(?:in|en|de|of|pour|pendant|for|during)\s+$/iu.test(sentence.slice(0, index))) continue;
    found.push({ kind: "date", ...date });
  }
  const words = [...sentence.matchAll(/[\p{L}\p{N}_]+(?:['’\-][\p{L}\p{N}_]+)*/gu)];
  for (const name of memberNames) {
    if (!name.trim()) continue;
    for (let i = 0; i < words.length; i++) for (let j = i; j < words.length; j++) {
      const start = words[i].index!;
      const end = words[j].index! + words[j][0].length;
      const raw = sentence.slice(start, end);
      if (normalize(raw) === normalize(name.trim())) found.push({ kind: "name", raw, value: normalize(name.trim()), start, end });
      const possessive = raw.replace(/['’]s$/iu, "");
      if (possessive !== raw && normalize(possessive) === normalize(name.trim())) found.push({ kind: "name", raw: possessive, value: normalize(name.trim()), start, end: start + possessive.length });
      if (raw.length > name.length + 4) break;
    }
  }
  // Status words are kept without accents, so search an accent free copy of the sentence. Removing an accent keeps the
  // length of an NFC string, so positions still point into the original.
  const plain = normalize(sentence.normalize("NFC"));
  const sameLength = plain.length === sentence.length;
  for (const match of plain.matchAll(RECEIVED_WORDS)) {
    found.push({ kind: "status", raw: sameLength ? sentence.slice(match.index!, match.index! + match[0].length) : match[0], value: "RECEIVED", start: match.index!, end: match.index! + match[0].length });
  }
  const statusWords = Object.keys(statusMap).sort((a, b) => b.length - a.length);
  for (const word of statusWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
    for (const match of plain.matchAll(re)) {
      const start = match.index!;
      const end = start + match[0].length;
      found.push({ kind: "status", raw: sameLength ? sentence.slice(start, end) : match[0], value: statusMap[word], start, end });
    }
  }
  // Members are called by name: an English gendered pronoun is never backed.
  for (const match of sentence.matchAll(/(?<![\p{L}])(he|she|his|her|hers|him|himself|herself)(?![\p{L}])/giu)) {
    found.push({ kind: "pronoun", raw: match[0], value: match[0].toLowerCase(), start: match.index!, end: match.index! + match[0].length });
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  let statusEnd = 0;
  for (const token of found) if (token.kind === "status") {
    if (token.value === "PAID" && isUnpaidClaim(plain.slice(statusEnd, token.end))) token.value = "UNPAID";
    statusEnd = token.end;
  }
  const accepted: typeof found = [];
  for (const token of found) if (!accepted.some((prior) => token.start < prior.end && token.end > prior.start)) accepted.push(token);
  // A received share describes a payment into the circle, not a pot received by the member.
  if (/\bshare\s+(?:was|is|has been)\s+received\b/iu.test(sentence)) {
    for (const token of accepted) if (token.value === "RECEIVED") token.value = "PAID";
  }
  return accepted.map(({ kind, raw, value }) => ({ kind, raw, value,
    ...(["PAID", "UNPAID", "RECEIVED", "PAID_OUT"].includes(value) ? { negative: financialPolarity(sentence) === "negative" } : {}),
  }));
}

// A sentence ends at . ! or ? followed by a space or the end, or at a new line. "60.00" stays whole.
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const dates = [...text.matchAll(/\b[\p{L}]+\b/gu)].flatMap((match) => {
    const mm = months[normalize(match[0])];
    return mm ? [writtenDate(text, match.index!, match[0], mm)] : [];
  });
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // A month abbreviation and its day or year stay in one claim.
    if (dates.some((date) => i >= date.start && i < date.end - 1)) {
      cur += ch;
      continue;
    }
    if (ch === "\n") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
    if (".!?".includes(ch)) {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        while (i + 1 < text.length && ".!?".includes(text[i + 1])) cur += text[++i];
        out.push(cur);
        cur = "";
      }
    }
  }
  out.push(cur);
  return out.map((part) => part.trim()).filter(Boolean);
}

function backingValues(say: Say, results: Record<string, unknown>): unknown[] {
  return say.refs.flatMap((ref) => Object.prototype.hasOwnProperty.call(results, ref) ? [results[ref]] : []);
}
function walk(value: unknown, visit: (value: unknown, key: string) => void, key = ""): void {
  visit(value, key);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit, key));
  else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, child]) => walk(child, visit, childKey));
}
const CENT_FIELDS = /^(?:cents|(?:amount|share|pot|now|later|minNow|paid|paidIn|received|collected|paidOut)Cents)$/u;
const DOLLAR_FIELDS = /^(?:amount|paidIn|paid|received)$/u;
function backed(token: Token, data: unknown[]): boolean {
  if (token.kind === "pronoun" || token.negative && token.value === "RECEIVED") return false;
  if (token.kind === "money") {
    let ok = false;
    data.forEach((root) => walk(root, (value, key) => {
      if (typeof value === "number" && (CENT_FIELDS.test(key) || DOLLAR_FIELDS.test(key)) && String(Math.round(value * (CENT_FIELDS.test(key) ? 1 : 100))) === token.value) ok = true;
      if (key === "amount" && value && typeof value === "object" && !Array.isArray(value)) {
        const amount = value as { value?: unknown; currency_code?: unknown };
        if ((!amount.currency_code || amount.currency_code === "USD") && typeof amount.value === "string" && amountCents(amount.value) === token.value) ok = true;
      }
    }));
    return ok;
  }
  const strings: string[] = [];
  data.forEach((root) => walk(root, (value) => { if (typeof value === "string") strings.push(value); }));
  if (token.kind === "date") {
    if (/^---\d{2}-\d{2}$/.test(token.value)) return strings.some((s) => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(s) && s.slice(4, 10) === token.value.slice(2));
    if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(token.value)) return strings.some((s) => s.includes(token.value));
    return strings.some((s) => s.includes(`-${token.value}-`) || s.endsWith(`-${token.value}`));
  }
  const json = JSON.stringify(data) ?? "";
  if (token.kind === "name") {
    const name = token.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const complete = new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, "u");
    return strings.some((s) => complete.test(normalize(s)));
  }
  const upper = json.toUpperCase();
  if (["PAID", "UNPAID", "RECEIVED"].includes(token.value)) {
    const statuses = strings.map((s) => s.toUpperCase());
    let positive = statuses.some((s) => ["PAID", "MARKED_AS_PAID", "COMPLETED", "RECEIVED"].includes(s));
    let unpaid = statuses.some((s) => ["UNPAID", "SENT", "DRAFT", "OVERDUE", "PAST_DUE", "PAYER_ACTION"].includes(s));
    let received = statuses.includes("RECEIVED");
    data.forEach((root) => walk(root, (value, key) => {
      if (typeof value !== "number") return;
      if (/^paid(?:In)?(?:Cents)?$/i.test(key)) {
        if (value > 0) positive = true;
        if (value === 0) unpaid = true;
      }
      if (/^received(?:Cents)?$/i.test(key) && value > 0) received = true;
    }));
    if (token.value === "PAID") return positive;
    if (token.value === "UNPAID") return unpaid && !positive;
    return received;
  }
  if (token.value === "OVERDUE") return upper.includes("OVERDUE") || upper.includes("PAST_DUE");
  if (token.value === "CANCELLED") return upper.includes("CANCELLED") || upper.includes("CANCELED");
  return upper.includes(token.value);
}

const SECOND_PERSON = /(?<![\p{L}])(you|your|yours|tu|tus|ton|ta|tes|toi|te|votre|vos|vous|su|sus|usted)(?![\p{L}])/iu;
const DUE_CLAIM = /\b(?:due|vence|vencen|vencimiento|echeance|exigible)\b/iu;

function dateBacking(token: Token, data: unknown[], clause: string): unknown[] {
  if (token.kind !== "date" || !DUE_CLAIM.test(normalize(clause))) return data;
  const dates: unknown[] = [];
  data.forEach((root) => walk(root, (value, key) => { if (key === "dueDate") dates.push(value); }));
  // Month statements from older schedule results may contain only a date field.
  return dates.length || token.value.length > 7 ? dates : data;
}

const financialTokens = (tokens: Token[]) => tokens.filter((t) => t.kind === "money" || t.kind === "status" && ["PAID", "UNPAID", "RECEIVED", "PAID_OUT"].includes(t.value));

// Split repeated financial predicates, while leaving shared subjects and decimal amounts intact.
function financialClauses(sentence: string, memberNames: string[]): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of sentence.matchAll(/\s+(?:and|y|et|but|pero|mais)\s+|;\s*|(?<!\d),(?!\d)\s*/giu)) {
    const before = sentence.slice(start, match.index);
    const after = sentence.slice(match.index! + match[0].length);
    if (financialTokens(extractTokens(before, memberNames)).length && financialTokens(extractTokens(after, memberNames)).length) {
      out.push(before);
      start = match.index! + match[0].length;
    }
  }
  out.push(sentence.slice(start));
  return out;
}

interface FinancialParty { role: "payer" | "recipient"; name?: string; collective: boolean; unresolved: boolean }

// Resolve complete identities in explicit payment roles, independently of their letter case.
function financialParties(clause: string, tokens: Token[], memberNames: string[]): FinancialParty[] {
  const claims = financialTokens(tokens);
  if (!claims.length) return [];
  const first = Math.min(...claims.map((t) => clause.indexOf(t.raw)).filter((i) => i >= 0));
  const tail = normalize(clause.slice(first)).split(/,\s*(?:so|because|donc|car|porque)\b/u)[0];
  const nameSpans = tokens.filter((t) => t.kind === "name").flatMap((t) => {
    const escaped = normalize(t.raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...tail.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  });
  const markers = [...tail.matchAll(/(?<![\p{L}\p{N}])(?:to|for|with|by|from|a|pour|avec|con|por|par)\s+/gu)]
    .filter((m) => !nameSpans.some((span) => m.index! >= span.start && m.index! < span.end));
  return markers.flatMap((marker, i): FinancialParty[] => {
    // Every explicit role must resolve, even when adverbs separate it from the payment.
    const prep = marker[0].trim();
    const rest = tail.slice(marker.index! + marker[0].length, markers[i + 1]?.index);
    const complete = rest.trim().replace(/[.!?]+$/u, "");
    const identity = memberNames.some((name) => normalize(name.trim()) === complete) ? complete :
      rest.split(/\s+(?:in|on|en|dans|during|due|round|ronda|tour)\b|\$|\bUSD\b/iu)[0].trim().replace(/[,.!?]+$/u, "").trim();
    // Invoice parts, rounds and dates describe the payment rather than another person.
    if (prep === "a" && /^(?:day|week|month|year)$/u.test(identity) ||
        /^(?:(?:the|la|le|el)\s+)?(?:part|parte|partie|round|ronda|tour)\b/u.test(identity) ||
        tokens.some((t) => t.kind === "date" && normalize(t.raw).replace(/\.+$/u, "") === identity)) return [];
    const name = memberNames.find((name) => normalize(name.trim()) === identity);
    const collective = /^(?:(?:the|le|la|el)\s+)?(?:pot|circle|group|cercle|groupe|fondo|bote|caisse)$/u.test(identity);
    return [{ role: ["by", "from", "por", "par"].includes(prep) ? "payer" : "recipient", name: name ? normalize(name.trim()) : undefined, collective, unresolved: !name && !collective }];
  });
}

// Financial subjects are explicit. Unknown people and vague identities must never inherit another member's facts.
function unknownFinancialSubject(clause: string, tokens: Token[], memberNames: string[]): boolean {
  const claims = financialTokens(tokens);
  if (!claims.length) return false;
  const first = Math.min(...claims.map((t) => clause.indexOf(t.raw)).filter((i) => i >= 0));
  let subject = normalize(clause.slice(0, first));
  for (const name of [...memberNames].sort((a, b) => b.length - a.length)) {
    const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    subject = subject.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"), "");
  }
  for (const token of tokens.filter((t) => t.kind === "date")) subject = subject.replace(normalize(token.raw), "");
  subject = subject.replace(/['’]s\b/gu, "").replace(/\b(?:hasn't|haven't|hadn't|isn't|wasn't|hasn’t|haven’t|hadn’t|isn’t|wasn’t)\b/gu, "not");
  subject = subject.replace(/\b(?:each|everyone|every|member|pays|contributes|propuesta|proposition|proposal|reminder|rappel|recordatorio)\b/gu, "");
  subject = subject.replace(/\b(?:the|a|an|le|la|les|el|los|las|un|une|your|you|tu|tus|ton|ta|tes|vous|votre|vos|su|sus|usted|share|shares|part|parte|partie|aportacion|cotisation|pot|circle|group|cercle|groupe|fondo|bote|caisse|has|have|had|is|are|was|were|been|being|ha|han|a|ont|est|es|esta|collected|collecte|reuni|recaudado|and|y|et|of|de|del|in|en|on|for|pour|already|now|due|total|altogether|overall|not|never|yet|no|n|pas|encore|ne|owe|owes|puedes|pagar|puede|pay|can)\b/gu, "").replace(/[^\p{L}]/gu, "");
  subject = subject.replace(/^(?:verse[es]?|envoye[es]?)$/u, "");
  return !!subject || financialParties(clause, tokens, memberNames).some((party) => party.unresolved);
}

function typedFinancialCheck(clause: string, tokens: Token[], data: unknown[], opts: DropOptions, memberNames: string[]): { checked: boolean; bad?: Token } {
  const claims = financialTokens(tokens);
  if (!claims.length) return { checked: false };
  const facts = records(data).filter((r) => ["share_amount", "pot_amount", "member_payment", "collected_total", "payout"].includes(String((r as { kind?: string }).kind))) as FinancialFact[];
  if (!facts.length) {
    if (financialPolarity(clause) !== "positive" && claims.some((t) => ["RECEIVED", "PAID_OUT"].includes(t.value))) return { checked: true, bad: claims[0] };
    return { checked: false };
  }
  const text = normalize(clause);
  const names = [...new Set(tokens.filter((t) => t.kind === "name").map((t) => t.value))];
  if (SECOND_PERSON.test(clause) && opts.speakerName && !names.includes(normalize(opts.speakerName))) names.push(normalize(opts.speakerName));
  const round = /\b(?:round|ronda|tour)\s+(\d+)\b/u.exec(text);
  const part = /\b(?:part|parte|partie)\s+(\d+)\b/u.exec(text);
  const collective = /\b(?:pot|circle|group|cercle|groupe|fondo|bote|caisse)\b/u.test(text);
  const collected = /\b(?:collected|collecte[es]?|reuni[es]?|recaudad[oa])\b/u.test(text);
  const payout = claims.some((t) => t.value === "PAID_OUT") || /\b(?:paid\s+out|payout|verse[es]?|envoye[es]?)\b/u.test(text);
  const received = claims.some((t) => t.value === "RECEIVED");
  const paid = claims.some((t) => t.value === "PAID");
  const unpaid = claims.some((t) => t.value === "UNPAID");
  const aggregate = /\b(?:total|altogether|overall)\b/u.test(text);
  const dueClaim = DUE_CLAIM.test(text) || /\b(?:owe|owes)\b/u.test(text);
  const eachShare = /\b(?:each|everyone|every member)\s+(?:pays|contributes)\b/u.test(text);
  if (eachShare) {
    const shares = facts.filter((f) => f.kind === "share_amount");
    return { checked: true, bad: shares.length && shares.every((f) => claims.every((t) => t.kind === "money" && String(f.cents) === t.value)) ? undefined : claims[0] };
  }
  const polarity = financialPolarity(clause);
  if (polarity === "uncertain") return { checked: true, bad: claims[0] };
  const negative = polarity === "negative";
  const paymentClaim = paid || unpaid || received || payout || collected;
  const expectedKind = names.length ? received || payout ? "payout" : paymentClaim || dueClaim ? "member_payment" : "share_amount" : payout ? "payout" : collective || collected ? paymentClaim ? "collected_total" : "pot_amount" : undefined;
  if (!expectedKind) return { checked: true, bad: claims[0] };
  const parties = financialParties(clause, tokens, memberNames);
  // Payout facts name the recipient. Share payment facts name the payer and money goes into the circle.
  if (parties.some((party) => party.unresolved || expectedKind === "payout" && (party.role === "payer" && !party.collective || party.role === "recipient" && party.collective) ||
      expectedKind === "member_payment" && (party.role === "recipient" && !party.collective || party.role === "payer" && party.collective))) {
    return { checked: true, bad: claims[0] };
  }
  if (!names.length && collective && paid && !collected && !claims.some((t) => t.kind === "money")) return { checked: true, bad: claims[0] };
  const who = names.length ? names : [undefined];
  for (const name of who) {
    const supports = facts.some((fact) => {
      const amountFact = expectedKind === "share_amount" && fact.kind === "member_payment" || expectedKind === "pot_amount" && fact.kind === "payout";
      if (fact.kind !== expectedKind && !amountFact || round && fact.round !== Number(round[1])) return false;
      if (name && (!("name" in fact) || normalize(fact.name) !== name)) return false;
      if (part && (fact.kind !== "member_payment" || fact.part !== Number(part[1]))) return false;
      if (fact.kind === "member_payment" && aggregate && fact.part !== undefined) return false;
      if (fact.kind === "member_payment" && DUE_CLAIM.test(text) && !tokens.filter((t) => t.kind === "date").every((t) => backed(t, [fact.dueDate]))) return false;
      let amount: number | undefined;
      if (fact.kind === "share_amount" || fact.kind === "pot_amount") amount = fact.cents;
      else if (fact.kind === "collected_total") {
        if (unpaid || received || payout) return false;
        amount = fact.collectedCents;
        if ((paid || collected) && amount <= 0 && !claims.some((t) => t.kind === "money" && t.value === "0")) return false;
      } else if (fact.kind === "payout") {
        if (!amountFact) {
          if (negative) {
            // Sending and failed payouts may still reach the account. Only a known unsent pot backs a denial.
            if (!["waiting", "drafted"].includes(fact.status) || fact.paidOutCents !== 0) return false;
          } else if (fact.status !== "paid" || fact.paidOutCents <= 0) return false;
        }
        amount = amountFact || negative ? fact.cents : fact.paidOutCents;
      } else {
        if (paid && !(typeof fact.paidCents === "number" && fact.paidCents > 0)) return false;
        if (unpaid && (fact.part === undefined || fact.paidCents !== 0)) return false;
        if (dueClaim && !paid && fact.paidCents !== 0) return false;
        amount = paid ? fact.paidCents : fact.cents;
      }
      return claims.filter((t) => t.kind === "money").every((t) => amount !== undefined && String(amount) === t.value);
    });
    if (!supports) return { checked: true, bad: claims[0] };
  }
  return { checked: true };
}

/** Every object inside the backing data, so a member's claims can be required to sit in one record. */
function records(data: unknown[]): unknown[] {
  const out: unknown[] = [];
  data.forEach((root) =>
    walk(root, (value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) out.push(value);
    }),
  );
  return out;
}

/**
 * Each member's clause must find every date, amount and status in one record naming that member.
 * In a member's own chat, "your" means that member.
 */
function pairUnbacked(sentence: string, tokens: Token[], data: unknown[], opts: DropOptions, memberNames: string[]): { token: Token; clause: string } | undefined {
  const claims = tokens.filter((t) => t.kind === "date" || t.kind === "money" || t.kind === "status");
  if (claims.length === 0) return undefined;
  let names = [...new Set(tokens.filter((t) => t.kind === "name").map((t) => t.value))];
  if (names.length === 0 && opts.speakerName && SECOND_PERSON.test(sentence)) names = [normalize(opts.speakerName)];
  if (names.length === 0) return undefined;
  // A list of everyone (the whole rotation) is not one record: keep records that mention one member only.
  const all = memberNames.map(normalize);
  const recs = records(data).flatMap((value) => {
    const r = value as Record<string, unknown>;
    if (!Array.isArray(r.parts)) return [r];
    // A share is a container, never evidence that one part's amount has another part's status.
    const identity = { name: r.name, memberId: r.memberId, round: r.round };
    return [
      ...r.parts.map((part, i) => ({ ...identity, part: i + 1, ...part })),
      ...(typeof r.paidCents === "number" ? [{ ...identity, paidCents: r.paidCents, aggregate: true }] : []),
    ];
  }).filter((r) => {
    const text = normalize(JSON.stringify(r));
    return all.filter((n) => text.includes(n)).length <= 1 || (names.length > 1 && claims.every((t) => t.kind === "status" && t.value === "APPLIED"));
  });
  // A pot belongs to its recipient, even when the round also contains everyone's shares.
  const pots: unknown[] = [];
  for (const r of records(data) as Record<string, unknown>[]) {
    if (r.recipient && r.potStatus) pots.push({ recipient: r.recipient, status: r.potStatus, cents: r.potCents });
    if (r.recipientId && r.status) pots.push(r);
  }
  const isPot = (r: Record<string, unknown>) => !!(r.kind === "payout" || r.recipient || r.recipientId || r.potStatus);
  const directionData = (r: Record<string, unknown>, direction: ReturnType<typeof claimDirection>): unknown => {
    if (direction === "received") {
      if (isPot(r)) return String(r.potStatus || r.status).toLowerCase() === "paid"
        ? { status: "RECEIVED", cents: r.potCents ?? r.cents, date: r.paidAt, potDate: r.potDate } : {};
      return { receivedCents: r.receivedCents, received: r.received, status: r.status === "RECEIVED" ? "RECEIVED" : undefined };
    }
    if (direction === "paid") {
      if (isPot(r)) return {};
      return Object.fromEntries(Object.entries(r).filter(([key, value]) => !["direction", "round", "part", "memberId"].includes(key) && !/^received|^pot/i.test(key) && (value === null || typeof value !== "object")));
    }
    return r;
  };
  const check = (clause: string, claimTokens: Token[], who: string[]): { token: Token; clause: string } | undefined => {
    const direction = claimDirection(clause);
    const round = /\b(?:round|ronda|tour)\s+(\d+)\b/iu.exec(clause);
    const part = /\b(?:part|parte|partie)\s+(\d+)\b/iu.exec(clause);
    const aggregate = /\b(?:total|altogether|overall)\b/iu.test(clause);
    for (const name of who) {
      const own = [...recs, ...pots].filter((r) => {
        const record = r as Record<string, unknown>;
        const identity = isPot(record) ? record.recipient || record.recipientId : record;
        return backed({ kind: "name", raw: name, value: name }, [identity]);
      }) as Record<string, unknown>[];
      const supports = (r: Record<string, unknown>, token: Token) => {
        let tokenDirection = token.kind === "money" ? direction : undefined;
        if (token.kind === "status" && token.value === "RECEIVED") tokenDirection = "received";
        if (token.kind === "status" && ["PAID", "UNPAID"].includes(token.value)) tokenDirection = "paid";
        const data = [directionData(r, tokenDirection)];
        return backed(token, dateBacking(token, data, clause));
      };
      if (!own.some((r) => (!round || r.round === Number(round[1])) && (!part || r.part === Number(part[1])) &&
        (!aggregate || !direction || direction !== "paid" || typeof r.paidCents === "number" || typeof r.paidInCents === "number" || typeof r.paidIn === "number") &&
        claimTokens.every((token) => supports(r, token)))) {
        return { token: claimTokens.find((token) => !own.some((r) => supports(r, token))) || claimTokens[0], clause };
      }
    }
    return undefined;
  };
  if (names.length > 1) {
    // Do not split a decimal comma or a thousands separator.
    const clauses = sentence.split(/(?<!\d),(?!\d)|\b(?:and|y|et)\b/iu).map((s) => s.trim()).filter(Boolean);
    const parts = clauses.map((clause) => {
      const ts = extractTokens(clause, memberNames);
      return { clause, claims: ts.filter((t) => ["money", "date", "status"].includes(t.kind)), names: [...new Set(ts.filter((t) => t.kind === "name").map((t) => t.value))], tokens: ts };
    });
    if (parts.every((p) => p.names.length === 1 && p.claims.length > 0 && p.tokens[0]?.kind === "name")) {
      for (const part of parts) {
        const bad = check(part.clause, part.claims, part.names);
        if (bad) return bad;
      }
      return undefined;
    }
  }
  return check(sentence, claims, names);
}

export function applyDropRule(says: Say[], results: Record<string, unknown>, memberNames: string[], opts: DropOptions = {}): DropResult {
  const kept: Say[] = []; const dropped: DropResult["dropped"] = [];
  for (const say of says) {
    const data = backingValues(say, results); const remaining: string[] = [];
    for (const sentence of splitSentences(say.text)) {
      let failure: { token: Token; clause?: string } | undefined;
      for (const clause of financialClauses(sentence, memberNames)) {
        const tokens = extractTokens(clause, memberNames);
        if (unknownFinancialSubject(clause, tokens, memberNames)) { failure = { token: financialTokens(tokens)[0], clause }; break; }
        const financial = typedFinancialCheck(clause, tokens, data, opts, memberNames);
        if (financial.bad) { failure = { token: financial.bad, clause }; break; }
        const names = new Set(tokens.filter((token) => token.kind === "name").map((token) => token.value));
        const pairedMember = names.size > 0 || (names.size === 0 && opts.speakerName && SECOND_PERSON.test(clause));
        const unchecked = financial.checked ? tokens.filter((t) => !financialTokens([t]).length) : tokens;
        const paired = pairUnbacked(clause, unchecked, data, opts, memberNames);
        const unsupported = paired?.token || unchecked.find((token) => {
          // These claims were checked together in that member's record. Other members cannot back or veto them.
          if (pairedMember && ["date", "money", "status"].includes(token.kind)) return false;
          return !backed(token, dateBacking(token, data, clause));
        });
        if (unsupported) { failure = { token: unsupported, clause: paired?.clause || clause }; break; }
      }
      if (failure) dropped.push({ say, sentence, token: failure.token.raw, clause: failure.clause }); else remaining.push(sentence);
    }
    if (remaining.length) kept.push({ ...say, text: remaining.join(" ") });
  }
  return { kept, dropped };
}
