// A new circle from the organiser's plain words: the words reader finds members, share, start and needs; the solver
// builds a rotation that meets every need it can; the members map onto the six sandbox personas.

import { MAX_MEMBERS, MAX_SHARE_CENTS } from "../caps";
import { newId, type Circle, type Member } from "./model";
import { solveRotation, type Need } from "./solver";
import { parseCircleText, slugId } from "./words";

export interface Draft {
  circle?: Circle;
  error?: string;
  notes: string[];
  broken: string[];
}

export function confirmersFrom(text: string, members: Member[]): string[] {
  const byName = (n: string) => members.find((m) => m.name.toLowerCase() === n.toLowerCase())?.id;
  const m = /([\p{Lu}][\p{L}'-]*)\s+and\s+([\p{Lu}][\p{L}'-]*)\s+(?:confirm|approve|sign off)/u.exec(text);
  const picked = m ? [byName(m[1]), byName(m[2])].filter((x): x is string => !!x) : [];
  if (picked.length === 2 && picked[0] !== picked[1]) return picked;
  // Default: the first two members.
  return members.slice(0, 2).map((x) => x.id);
}

export function draftCircle(text: string, today: string, opts: { id?: string; demo?: boolean; startMonth?: string } = {}): Draft {
  const parsed = parseCircleText(text.slice(0, 2000), today);
  const notes = [...parsed.notes];
  if (parsed.members.length < 2) return { error: "A circle needs at least 2 members. Try: 6 of us, $100 a month from December.", notes, broken: [] };
  if (parsed.members.length > MAX_MEMBERS) return { error: `The demo keeps circles to ${MAX_MEMBERS} members.`, notes, broken: [] };
  const shareCents = parsed.shareCents ?? 10000;
  if (parsed.shareCents === null) notes.push("no amount found, so the share is $100.00");
  if (shareCents < 100 || shareCents > MAX_SHARE_CENTS) return { error: "The demo keeps a share between $1 and $100.", notes, broken: [] };
  const startMonth = opts.startMonth || parsed.startMonth || nextMonth(today);
  const taken = new Set<string>();
  const members: Member[] = parsed.members.map((m, i) => {
    const id = slugId(m.name, taken);
    taken.add(id);
    return { id, name: m.name, lang: m.lang, slot: i + 1, token: newId(16) };
  });
  const idByName = (n: string) => members.find((m) => m.name === n)?.id;
  const needs: Need[] = parsed.needs
    .map((n) => ({ memberId: idByName(n.name) || "", kind: n.kind, month: n.month, text: n.text }))
    .filter((n) => n.memberId);
  const solved = solveRotation({ memberIds: members.map((m) => m.id), startMonth, needs, payDay: parsed.rules.payDay ?? 15 });
  const broken = solved.ok ? [] : solved.broken.map((b) => b.text || `${b.memberId} ${b.kind} ${b.month}`);
  const accepted = solved.ok ? needs : needs.filter((n) => !solved.broken.includes(n));
  const circle: Circle = {
    id: opts.id || newId(10),
    name: opts.demo ? "Saturday circle" : "Our circle",
    currency: "USD",
    shareCents,
    startMonth,
    payDay: parsed.rules.payDay ?? 15,
    members,
    needs: accepted,
    brokenNeeds: broken,
    rules: {
      privacy: parsed.rules.privacy ?? true,
      shortShare: { allowed: true, minNowCents: Math.round(shareCents / 2), laterDays: 14, ...parsed.rules.shortShare },
      missed: { graceDays: 3, action: "move_to_end", ...parsed.rules.missed },
      confirmers: confirmersFrom(text, members),
    },
    rotation: solved.rotation,
    organiserToken: newId(16),
    status: "draft",
    demo: !!opts.demo,
    createdAt: new Date().toISOString(),
    version: 1,
    unused: parsed.unused,
  };
  return { circle, notes, broken };
}

function nextMonth(today: string): string {
  const d = new Date(today.slice(0, 7) + "-15T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}
