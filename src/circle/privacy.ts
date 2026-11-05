import { extractTokens, isUnpaidClaim } from "../ai/drop";
import type { Circle } from "./model";

/** A member's amounts and debts are private to that member and the organiser. */
export function privateMemberClaim(c: Circle, to: string, sentence: string): boolean {
  if (!c.rules.privacy || to === "organiser") return false;
  const tokens = extractTokens(sentence, c.members.map((m) => m.name));
  const names = tokens.filter((t) => t.kind === "name");
  const own = c.members.find((m) => to === `member:${m.id}`);
  const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!names.some((t) => !own || t.value !== plain(own.name))) return false;
  return tokens.some((t) => t.kind === "money" || (t.kind === "status" && ["UNPAID", "OVERDUE"].includes(t.value))) || isUnpaidClaim(sentence) ||
    /\b(?:paso su fecha|depasse sa date)\b/iu.test(plain(sentence)) ||
    /\b(?:owes?|owed|owing|due|unpaid|debe[ns]?|adeuda[ns]?|pendiente|impagad[oa]s?|doit|doivent|dues?|(?:est|sont)\s+dus?|impaye[es]?)\b/iu.test(plain(sentence));
}
