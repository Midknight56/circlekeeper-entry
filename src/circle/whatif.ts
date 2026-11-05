// Previews re-solve only waiting turns. They never change the circle or call PayPal.

import type { Ctx } from "./context";
import { monthName } from "./messages";
import { keys, memberById, newId, partPaid, type Circle, type Lang, type Pot, type Share } from "./model";
import { monthOfRound, solveRotation, type Need, type Slot } from "./solver";
import { loadCircle } from "./shares";

export type WhatIfChange =
  | { kind: "leave"; memberId: string; month: string }
  | { kind: "join"; name: string }
  | { kind: "need"; memberId: string; needKind: Need["kind"]; month: string };

export interface WhatIfPreview {
  rotation: Slot[];
  lines: Record<Lang, string[]>;
  money: Record<Lang, string[]>;
  broken: string[];
  potCentsByRound?: Record<number, number>;
  name?: string;
  members?: { id: string; name: string }[];
  people?: { memberId: string; name: string; paidInCents: number; receivedCents: number }[];
}

const LANGS: Lang[] = ["en", "es", "fr"];

function dollars(cents: number, lang: Lang): string {
  return new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(cents / 100);
}

function nextMonth(month: string, count: number): string {
  return monthOfRound(month, count + 1);
}

function lineFor(text: Record<Lang, string>, out: Record<Lang, string[]>): void {
  for (const lang of LANGS) out[lang].push(text[lang]);
}

async function isWaiting(ctx: Ctx, round: number): Promise<boolean> {
  const pot = await ctx.store.get<Pot>(keys.pot(round));
  return !pot || pot.status === "waiting";
}

async function paidIn(ctx: Ctx, memberId: string): Promise<number> {
  const shares = await ctx.store.list<Share>({ prefix: "share:" });
  return [...shares.values()].filter((share) => share.memberId === memberId)
    .flatMap((share) => share.parts).filter(partPaid).reduce((sum, part) => sum + part.cents, 0);
}

async function received(ctx: Ctx, memberId: string): Promise<number> {
  const pots = await ctx.store.list<Pot>({ prefix: "pot:" });
  return [...pots.values()].filter((pot) => pot.recipientId === memberId && pot.status === "paid")
    .reduce((sum, pot) => sum + pot.cents, 0);
}

function openNeeds(c: Circle, memberIds: string[], needs: Need[]): Need[] {
  const members = new Set(memberIds);
  return needs.filter((need) => members.has(need.memberId));
}

function solveOpen(c: Circle, slots: Slot[], memberIds: string[], needs: Need[]): { rotation: Slot[]; broken: string[] } {
  if (!slots.length || !memberIds.length) return { rotation: [], broken: [] };
  const usedNeeds = openNeeds(c, memberIds, needs);
  const result = solveRotation({ memberIds, startMonth: slots[0].month, needs: usedNeeds, payDay: c.payDay });
  const broken = result.ok ? [] : result.broken.map((need) => need.text || `${memberById(c, need.memberId)?.name || need.memberId} needs ${need.month}`);
  const byRound = new Map(result.rotation.map((slot) => [slot.round, slot.memberId]));
  const mapped = slots.slice(0, memberIds.length).map((slot, i) => ({ ...slot, memberId: byRound.get(i + 1) || memberIds[i] }));
  for (const need of usedNeeds) {
    const assigned = mapped.find((slot) => slot.memberId === need.memberId);
    if (assigned && !holds(need, assigned.month)) {
      const text = need.text || `${memberById(c, need.memberId)?.name || need.memberId} needs ${need.month}`;
      if (!broken.includes(text)) broken.push(text);
    }
  }
  return { rotation: mapped, broken };
}

function holds(need: Need, month: string): boolean {
  if (need.kind === "want") return month === need.month;
  if (need.kind === "avoid") return month !== need.month;
  if (need.kind === "on_or_before") return month <= need.month;
  return month >= need.month;
}

export async function previewWhatIf(ctx: Ctx, change: WhatIfChange): Promise<WhatIfPreview> {
  const c = await loadCircle(ctx);
  const pots = await ctx.store.list<Pot>({ prefix: "pot:" });
  const base = [...c.rotation].sort((a, b) => a.round - b.round);
  const lines: Record<Lang, string[]> = { en: [], es: [], fr: [] };
  const money: Record<Lang, string[]> = { en: [], es: [], fr: [] };
  const broken: string[] = [];
  const potCentsByRound: Record<number, number> = {};
  const people: NonNullable<WhatIfPreview["people"]> = [];
  let rotation = base.map((slot) => ({ ...slot }));
  let members = c.members.map(({ id, name }) => ({ id, name }));

  if (change.kind === "join") {
    const id = `join-${newId(5)}`;
    const last = base[base.length - 1];
    const month = nextMonth(last.month, 1);
    const round = last.round + 1;
    rotation.push({ round, memberId: id, month, date: `${month}-${String(c.payDay).padStart(2, "0")}` });
    // A joiner pays from their own round after the last current round. Current pots keep their amounts;
    // every round from the new round on has one more share.
    members = [...members, { id, name: change.name }];
    const cents = c.shareCents * members.length;
    potCentsByRound[round] = cents;
    const pot = { en: dollars(cents, "en"), es: dollars(cents, "es"), fr: dollars(cents, "fr") };
    lineFor({
      en: `${change.name} joins in ${monthName(month, "en")}. The new pot is ${pot.en} from ${members.length} shares.`,
      es: `${change.name} se une en ${monthName(month, "es")}. El nuevo fondo será de ${pot.es} con ${members.length} partes.`,
      fr: `${change.name} rejoint le cercle en ${monthName(month, "fr")}. Le nouveau pot sera de ${pot.fr} pour ${members.length} parts.`,
    }, lines);
  } else {
    if (change.kind === "leave" && !memberById(c, change.memberId)) throw new Error("that person is not in this circle");
    if (change.kind === "need" && !memberById(c, change.memberId)) throw new Error("that person is not in this circle");
    const targetMonth = change.kind === "leave" ? change.month : c.startMonth;
    const open: Slot[] = [];
    for (const slot of base) if (slot.month >= targetMonth && await isWaiting(ctx, slot.round)) open.push(slot);
    const closed = base.filter((slot) => !open.some((item) => item.round === slot.round));
    let needs = [...c.needs];
    let active = open.map((slot) => slot.memberId);
    if (change.kind === "leave") {
      active = active.filter((id) => id !== change.memberId);
      members = members.filter((member) => member.id !== change.memberId);
      if (open.some((slot) => slot.memberId === change.memberId)) open.pop();
      needs = needs.filter((need) => need.memberId !== change.memberId);
    } else {
      needs = [...needs, { memberId: change.memberId, kind: change.needKind, month: change.month }];
      if (!active.includes(change.memberId)) broken.push(`${memberById(c, change.memberId)?.name || change.memberId} has no open turn for the new need`);
    }
    const solved = solveOpen(c, open, active, needs);
    rotation = [...closed, ...solved.rotation].sort((a, b) => a.round - b.round);
    broken.push(...solved.broken);
    if (change.kind === "leave") {
      const person = memberById(c, change.memberId)!;
      const oldTurn = base.find((slot) => slot.memberId === change.memberId);
      const toLines = {
        en: [`${person.name} leaves in ${monthName(change.month, "en")}. The open turns are planned again.`],
        es: [`${person.name} sale en ${monthName(change.month, "es")}. Se vuelven a ordenar los turnos libres.`],
        fr: [`${person.name} quitte le cercle en ${monthName(change.month, "fr")}. Les tours libres sont recalculés.`],
      };
      for (const lang of LANGS) lines[lang].push(...toLines[lang]);
      if (oldTurn && !rotation.some((slot) => slot.memberId === change.memberId)) {
        lineFor({
          en: `${person.name}'s turn in ${monthName(oldTurn.month, "en")} is removed.`,
          es: `Se elimina el turno de ${person.name} en ${monthName(oldTurn.month, "es")}.`,
          fr: `Le tour de ${person.name} en ${monthName(oldTurn.month, "fr")} est supprimé.`,
        }, lines);
      }
      const moved = rotation.filter((slot) => base.some((old) => old.memberId === slot.memberId && old.month !== slot.month));
      for (const slot of moved) {
        const old = base.find((item) => item.memberId === slot.memberId)!;
        const cents = c.shareCents * Math.max(1, c.members.length - 1);
        const amount = { en: dollars(cents, "en"), es: dollars(cents, "es"), fr: dollars(cents, "fr") };
        lineFor({
          en: `${memberById(c, slot.memberId)?.name} moves from ${monthName(old.month, "en")} to ${monthName(slot.month, "en")}. Pot: ${amount.en}.`,
          es: `${memberById(c, slot.memberId)?.name} pasa de ${monthName(old.month, "es")} a ${monthName(slot.month, "es")}. Fondo: ${amount.es}.`,
          fr: `${memberById(c, slot.memberId)?.name} passe de ${monthName(old.month, "fr")} à ${monthName(slot.month, "fr")}. Pot : ${amount.fr}.`,
        }, lines);
      }
      if (c.rules.confirmers.includes(change.memberId)) {
        lineFor({ en: `The circle needs a new confirmer because ${person.name} is leaving.`, es: `El círculo necesita otra persona que confirme porque ${person.name} se va.`, fr: `Le cercle a besoin d'une nouvelle personne pour confirmer, car ${person.name} part.` }, lines);
      }
      // Every remaining waiting pot from the leaving month loses a share, even if its recipient stays put.
      for (const slot of rotation) if (slot.month >= change.month && await isWaiting(ctx, slot.round)) {
        potCentsByRound[slot.round] = c.shareCents * members.length;
      }
      const cents = await paidIn(ctx, change.memberId);
      const receivedCents = await received(ctx, change.memberId);
      people.push({ memberId: person.id, name: person.name, paidInCents: cents, receivedCents });
      lineFor({
        en: `${person.name} has paid in ${dollars(cents, "en")} and received ${dollars(receivedCents, "en")}. The circle needs to agree how to settle this.`,
        es: `${person.name} ha pagado ${dollars(cents, "es")} y ha recibido ${dollars(receivedCents, "es")}. El círculo tiene que acordar cómo resolverlo.`,
        fr: `${person.name} a versé ${dollars(cents, "fr")} et a reçu ${dollars(receivedCents, "fr")}. Le cercle doit décider comment régler cela.`,
      }, money);
      if (!oldTurn) broken.push(`${person.name} has no turn in the rotation`);
    } else {
      const person = memberById(c, change.memberId)!;
      const m = { en: monthName(change.month, "en"), es: monthName(change.month, "es"), fr: monthName(change.month, "fr") };
      const said = {
        want: { en: `${person.name} needs the pot in ${m.en}.`, es: `${person.name} necesita el fondo en ${m.es}.`, fr: `${person.name} a besoin du pot en ${m.fr}.` },
        avoid: { en: `${person.name} cannot take the pot in ${m.en}.`, es: `${person.name} no puede recibir el fondo en ${m.es}.`, fr: `${person.name} ne peut pas recevoir le pot en ${m.fr}.` },
        on_or_before: { en: `${person.name} needs the pot by ${m.en}.`, es: `${person.name} necesita el fondo a más tardar en ${m.es}.`, fr: `${person.name} a besoin du pot au plus tard en ${m.fr}.` },
        on_or_after: { en: `${person.name} needs the pot in ${m.en} or later.`, es: `${person.name} necesita el fondo en ${m.es} o después.`, fr: `${person.name} a besoin du pot en ${m.fr} ou plus tard.` },
      }[change.needKind];
      lineFor(said, lines);
      for (const slot of rotation) {
        const old = base.find((item) => item.memberId === slot.memberId);
        if (!old || old.month === slot.month) continue;
        const cents = c.shareCents * c.members.length;
        const amount = { en: dollars(cents, "en"), es: dollars(cents, "es"), fr: dollars(cents, "fr") };
        lineFor({
          en: `${memberById(c, slot.memberId)?.name} moves from ${monthName(old.month, "en")} to ${monthName(slot.month, "en")}. Pot: ${amount.en}.`,
          es: `${memberById(c, slot.memberId)?.name} pasa de ${monthName(old.month, "es")} a ${monthName(slot.month, "es")}. Fondo: ${amount.es}.`,
          fr: `${memberById(c, slot.memberId)?.name} passe de ${monthName(old.month, "fr")} à ${monthName(slot.month, "fr")}. Pot : ${amount.fr}.`,
        }, lines);
      }
    }
  }

  const preview: WhatIfPreview = { rotation, lines, money, broken, members, potCentsByRound, people };
  await ctx.store.put("whatif:current", preview);
  return preview;
}
