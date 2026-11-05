// Messages to the group, to one member, or to the organiser. Fixed lines in each member's language live here.

import type { Ctx } from "./context";
import { newId, type Circle, type Lang, type Msg } from "./model";
import { extractTokens, splitSentences } from "../ai/drop";
import { privateMemberClaim } from "./privacy";

export async function addMsg(ctx: Ctx, m: Omit<Msg, "id" | "at"> & { at?: string }): Promise<Msg> {
  if (m.to === "group" && m.kind !== "chat") {
    const c = await ctx.store.get<Circle>("circle");
    if (c?.rules.privacy) {
      const tokens = extractTokens(m.text, c.members.map((member) => member.name));
      if (tokens.some((t) => t.kind === "name")) {
        let text = m.text;
        for (const token of tokens.filter((t) => t.kind === "money")) text = text.replace(token.raw, "…");
        m = { ...m, text };
      }
    }
  }
  if (m.from === "treasurer" && m.kind !== "ask" && (m.to === "group" || m.to.startsWith("member:"))) {
    const c = await ctx.store.get<Circle>("circle");
    if (c) m = { ...m, text: splitSentences(m.text).filter((sentence) => !privateMemberClaim(c, m.to, sentence)).join(" ") || "Please check your circle page." };
  }
  const msg: Msg = { id: newId(8), at: m.at || ctx.now().toISOString(), ...m } as Msg;
  await ctx.store.put(`msg:${msg.at}:${msg.id}`, msg);
  return msg;
}

/** Messages one viewer may see: a member sees the group and their own; the organiser sees the group and theirs. */
export async function listMessages(ctx: Ctx, viewer: { memberId?: string; organiser?: boolean }, limit = 200): Promise<Msg[]> {
  const all = [...(await ctx.store.list<Msg>({ prefix: "msg:" })).values()];
  const mine = all.filter((m) => {
    if (m.to === "group") return true;
    if (viewer.organiser && m.to === "organiser") return true;
    if (viewer.memberId && (m.to === `member:${viewer.memberId}` || (m.from === viewer.memberId && m.to === "treasurer"))) return true;
    if (viewer.organiser && m.from === "organiser") return true;
    return false;
  });
  return mine.slice(-limit);
}

export async function addChange(ctx: Ctx, text: string): Promise<void> {
  const at = ctx.now().toISOString();
  await ctx.store.put(`change:${at}:${newId(4)}`, { at, text });
}

type Lines = Record<Lang, (v: Record<string, string>) => string>;

export const LINES: Record<string, Lines> = {
  paymentRecordPending: {
    en: () => "Your payment went through. We are still marking your share paid. There is nothing more to pay.",
    es: () => "Tu pago se ha recibido. Seguimos registrando tu parte como pagada. No tienes que pagar nada más.",
    fr: () => "Ton paiement est reçu. Nous enregistrons encore ta part comme payée. Tu n'as plus rien à payer.",
  },
  swapAskTo: {
    en: (v) => `${v.from} asked to swap turns with you: you would take ${v.fromMonth} instead of ${v.toMonth}. Tap Yes or No. Nothing moves unless you both say yes.`,
    es: (v) => `${v.from} pidió cambiar de turno contigo: tomarías ${v.fromMonth} en vez de ${v.toMonth}. Toca Sí o No. Nada cambia si no dicen que sí los dos.`,
    fr: (v) => `${v.from} demande d'échanger son tour avec toi : tu prendrais ${v.fromMonth} au lieu de ${v.toMonth}. Touche Oui ou Non. Rien ne bouge sans vos deux oui.`,
  },
  swapAskFrom: {
    en: (v) => `I asked ${v.to} privately about taking ${v.toMonth}. Tap Yes to confirm you want it. Nothing moves until you both say yes.`,
    es: (v) => `Le pregunté a ${v.to} en privado por ${v.toMonth}. Toca Sí para confirmar. Nada cambia hasta que los dos digan que sí.`,
    fr: (v) => `J'ai demandé à ${v.to} en privé pour ${v.toMonth}. Touche Oui pour confirmer. Rien ne bouge avant vos deux oui.`,
  },
  swapDone: {
    en: (v) => `${v.a} and ${v.b} swapped turns. Both agreed.`,
    es: (v) => `${v.a} y ${v.b} cambiaron de turno. Los dos estuvieron de acuerdo.`,
    fr: (v) => `${v.a} et ${v.b} ont échangé leur tour. Tous les deux étaient d'accord.`,
  },
  swapDeclined: {
    en: () => `The swap did not go ahead. The schedule stays as it was.`,
    es: () => `El cambio no se hizo. El calendario sigue igual.`,
    fr: () => `L'échange ne se fait pas. Le calendrier reste le même.`,
  },
  swapDeclineNext: {
    en: (v) => `${v.decliner} said no to the swap. That is okay. I have asked ${v.next} instead. Nothing has changed yet.`,
    es: (v) => `${v.decliner} dijo que no al cambio. Está bien. Le pregunté a ${v.next}. Nada ha cambiado todavía.`,
    fr: (v) => `${v.decliner} a dit non à l'échange. Ce n'est pas grave. J'ai demandé à ${v.next}. Rien n'a changé pour l'instant.`,
  },
  swapDeclineLast: {
    en: (v) => `${v.decliner} said no to the swap. That is okay. No one else can swap. Your schedule has not changed.`,
    es: (v) => `${v.decliner} dijo que no al cambio. Está bien. Nadie más puede cambiar de turno. Tu calendario no ha cambiado.`,
    fr: (v) => `${v.decliner} a dit non à l'échange. Ce n'est pas grave. Personne d'autre ne peut échanger son tour. Ton calendrier n'a pas changé.`,
  },
  splitAsk: {
    en: (v) => `You can pay $${v.now} now and $${v.later} by ${v.due}. Tap Yes and I will send two invoices in place of this one.`,
    es: (v) => `Puedes pagar ${v.nowEs} $ ahora y ${v.laterEs} $ antes del ${v.due}. Toca Sí y enviaré dos facturas en lugar de esta.`,
    fr: (v) => `Tu peux payer ${v.nowEs} $ maintenant et ${v.laterEs} $ avant le ${v.due}. Touche Oui et j'envoie deux factures à la place de celle-ci.`,
  },
  splitPending: {
    en: () => "Your share is being split. One part is not sent yet. Tap Try again.",
    es: () => "Tu parte se está dividiendo. Una factura aún no se ha enviado. Toca Intentar de nuevo.",
    fr: () => "Ta part est en cours de division. Une facture reste à envoyer. Touche Réessayer.",
  },
  splitDone: {
    en: (v) => `Your share is now two invoices: $${v.now} now and $${v.later} by ${v.due}.`,
    es: (v) => `Tu parte ahora son dos facturas: ${v.nowEs} $ ahora y ${v.laterEs} $ antes del ${v.due}.`,
    fr: (v) => `Ta part est maintenant en deux factures : ${v.nowEs} $ maintenant et ${v.laterEs} $ avant le ${v.due}.`,
  },
  reminder: {
    en: (v) => `Hi ${v.name}, a kind reminder: your share for this round is due ${v.due}. Thank you for keeping the circle going.`,
    es: (v) => `Hola ${v.name}, un recordatorio amable: tu parte de esta ronda vence el ${v.due}. Gracias por mantener el círculo.`,
    fr: (v) => `Bonjour ${v.name}, un petit rappel : ta part de ce tour est due le ${v.due}. Merci de faire vivre le cercle.`,
  },
  missedNotice: {
    en: (v) => `${v.member}'s share is past its due date and the grace days. The circle's rule: ${v.change} The confirmers decide. Nothing moves until they say yes.`,
    es: (v) => `La parte de ${v.member} pasó su fecha y los días de gracia. La regla del círculo: ${v.change} Deciden quienes confirman. Nada cambia hasta que digan que sí.`,
    fr: (v) => `La part de ${v.member} a dépassé sa date et les jours de grâce. La règle du cercle : ${v.change} Les personnes qui confirment décident. Rien ne bouge avant leur oui.`,
  },
  missedAsk: {
    en: (v) => `${v.member}'s share is past due. The circle's rule: ${v.change} Tap Yes to agree or No to keep the schedule. Nothing moves until the confirmers say yes.`,
    es: (v) => `La parte de ${v.member} está atrasada. La regla del círculo: ${v.change} Toca Sí para aceptar o No para dejar el calendario igual. Nada cambia hasta que quienes confirman digan que sí.`,
    fr: (v) => `La part de ${v.member} est en retard. La règle du cercle : ${v.change} Touche Oui pour accepter ou Non pour garder le calendrier. Rien ne bouge avant le oui des personnes qui confirment.`,
  },
  missedPrivate: {
    en: () => `Your share is still open. Your PayPal invoice stays live. Nothing was cancelled.`,
    es: () => `Tu parte sigue abierta. Tu factura de PayPal sigue activa. No se canceló nada.`,
    fr: () => `Ta part est toujours ouverte. Ta facture PayPal reste active. Rien n'a été annulé.`,
  },
  missedOrganiser: {
    en: (v) => `${v.member}'s share is past due. The circle's rule: ${v.change}${v.reason ? ` The turn cannot move: ${v.reason}.` : ""} The confirmers have been asked.`,
    es: (v) => `La parte de ${v.member} está atrasada. La regla del círculo: ${v.change}${v.reason ? ` El turno no puede moverse: ${v.reason}.` : ""} Ya se preguntó a quienes confirman.`,
    fr: (v) => `La part de ${v.member} est en retard. La règle du cercle : ${v.change}${v.reason ? ` Le tour ne peut pas bouger : ${v.reason}.` : ""} Les personnes qui confirment ont été consultées.`,
  },
  missedDeclined: {
    en: (v) => `${v.member}'s missed share rule was declined. The schedule did not change.`,
    es: (v) => `Se rechazó la regla por la parte pendiente de ${v.member}. El calendario no cambió.`,
    fr: (v) => `La règle pour la part en retard de ${v.member} a été refusée. Le calendrier n'a pas changé.`,
  },
  missedDone: {
    en: (v) => `The confirmers said yes. ${v.change}`,
    es: (v) => `Quienes confirman dijeron que sí. ${v.change}`,
    fr: (v) => `Les personnes qui confirment ont dit oui. ${v.change}`,
  },
};

export function line(key: keyof typeof LINES, lang: Lang, v: Record<string, string>): string {
  return (LINES[key][lang] || LINES[key].en)(v);
}

export function monthName(month: string, lang: Lang): string {
  const d = new Date(month + "-15T12:00:00Z");
  return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

export function dayName(date: string, lang: Lang): string {
  const d = new Date(date + "T12:00:00Z");
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

export function commaMoney(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
