// One turn with the treasurer: up to MAX_STEPS_PER_TURN model steps, each answering one JSON object.
// Code checks every action against the tool list and every sentence against the drop rule.

import { MAX_OUTPUT_TOKENS, MAX_STEPS_PER_TURN } from "../caps";
import { addLog, type Ctx } from "../circle/context";
import { addMsg } from "../circle/messages";
import { memberById, type Lang, type Msg } from "../circle/model";
import { loadCircle } from "../circle/shares";
import { privateMemberClaim } from "../circle/privacy";
import { applyDropRule, splitSentences, type Say } from "./drop";
import { TreasurerResting, type ChatMessage, type Model, type RestingReason } from "./model";
import { systemPrompt } from "./prompt";
import { circleView, currentRound, roundView, validateAction, type Speaker } from "./tools";

export interface TurnResult {
  said: Msg[];
  dropped: number;
  steps: number;
  refused: string[];
  neurons: number;
  recorded: boolean;
  resting?: string;
}

const FALLBACK: Record<Lang, string> = {
  en: "I could not answer that safely just now. The organiser can help, or try asking another way.",
  es: "No pude responder eso con seguridad ahora. El organizador puede ayudar, o pregunta de otra forma.",
  fr: "Je n'ai pas pu répondre à cela en toute sûreté. L'organisateur peut aider, ou pose la question autrement.",
};

const DEMO_ONLY: Record<Lang, string> = {
  en: "In this demo I answer the suggested messages. Tap one of them below.",
  es: "En esta demo respondo los mensajes sugeridos. Toca uno de abajo.",
  fr: "Dans cette démo je réponds aux messages proposés. Touche l'un d'eux ci-dessous.",
};

const RESTING: Record<Lang, string> = {
  en: "The treasurer is resting until tomorrow. Your taps and payments still work.",
  es: "La tesorera descansa hasta mañana. Tus botones y pagos siguen funcionando.",
  fr: "La trésorière se repose jusqu'à demain. Tes boutons et paiements marchent toujours.",
};

const SITE_OFF: Record<Lang, string> = {
  en: "Live answers are off on this site, so the treasurer does not reply to typed messages. Use the buttons on this page: pay part of a share now, ask to swap turns, or confirm a pot.",
  es: "Las respuestas en vivo están desactivadas en este sitio, así que la tesorera no responde a los mensajes escritos. Usa los botones de esta página: paga parte de una aportación ahora, pide cambiar turnos o confirma un fondo.",
  fr: "Les réponses en direct sont désactivées sur ce site, donc la trésorière ne répond pas aux messages saisis. Utilise les boutons de cette page : paie une partie de ta part maintenant, demande un échange de tours ou confirme un fonds.",
};

export function parseStep(text: string): { action: unknown; say: Say[] } | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(cleaned.slice(start, end + 1));
    if (!j || typeof j !== "object") return null;
    const say: Say[] = Array.isArray(j.say)
      ? j.say
          .filter((s: any) => s && typeof s.text === "string")
          .map((s: any) => ({ to: String(s.to || ""), text: s.text.slice(0, 600), refs: Array.isArray(s.refs) ? s.refs.map(String) : [] }))
      : [];
    return { action: j.action ?? null, say };
  } catch {
    return null;
  }
}

function speakerTarget(speaker: Speaker): string {
  return speaker.role === "member" ? `member:${speaker.memberId}` : "organiser";
}

/** A member's private chat answers that member only; the organiser's chat may also post to the group.
 *  A line addressed to anyone else is dropped, never redirected: it was written for someone else. */
function allowedTarget(speaker: Speaker, to: string): string | null {
  const t = to.trim().toLowerCase();
  if (speaker.role === "organiser") {
    if (t === "group") return "group";
    return t === "" || t === "organiser" ? "organiser" : null;
  }
  return t === "" || t === speaker.memberId || t === `member:${speaker.memberId}` ? speakerTarget(speaker) : null;
}

export async function runTurn(ctx: Ctx, model: Model, speaker: Speaker, text: string): Promise<TurnResult> {
  const c = await loadCircle(ctx);
  const lang: Lang = speaker.role === "member" ? memberById(c, speaker.memberId)?.lang || "en" : "en";
  const from = speaker.role === "member" ? speaker.memberId : "organiser";
  await addMsg(ctx, { to: "treasurer", from, text: text.slice(0, 1000), kind: "chat" });

  const round = await currentRound(ctx, c);
  const results: Record<string, unknown> = { call_0: circleView(c), call_1: await roundView(ctx, round, true, speaker) };
  const who = speaker.role === "member" ? { role: "member", id: speaker.memberId, name: memberById(c, speaker.memberId)?.name, lang } : { role: "organiser" };
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(speaker) },
    {
      role: "user",
      content: `call_0 (get_circle): ${JSON.stringify(results.call_0)}\ncall_1 (get_round ${round}): ${JSON.stringify(results.call_1)}\nWriting to you: ${JSON.stringify(who)}\nMessage: ${JSON.stringify(text.slice(0, 1000))}`,
    },
  ];

  const says: Say[] = [];
  const refused: string[] = [];
  let steps = 0;
  let neurons = 0;
  let recorded = false;
  let next = 2;
  let resting: string | undefined;
  let restingKind: RestingReason | undefined;

  try {
    while (steps < MAX_STEPS_PER_TURN) {
      steps++;
      let out = await model.complete(messages, MAX_OUTPUT_TOKENS);
      neurons += out.neurons;
      recorded = recorded || out.recorded;
      await addLog(ctx, { kind: "model", note: `step ${steps}`, neurons: out.neurons, recorded: out.recorded, raw: ctx.captureRaw ? out.text.slice(0, 3000) : undefined });
      let parsed = parseStep(out.text);
      if (!parsed && steps < MAX_STEPS_PER_TURN) {
        messages.push({ role: "assistant", content: out.text.slice(0, 2000) }, { role: "user", content: "Answer with one JSON object only, as described." });
        steps++;
        out = await model.complete(messages, MAX_OUTPUT_TOKENS);
        neurons += out.neurons;
        await addLog(ctx, { kind: "model", note: `step ${steps} (retry)`, neurons: out.neurons, recorded: out.recorded, raw: ctx.captureRaw ? out.text.slice(0, 3000) : undefined });
        parsed = parseStep(out.text);
      }
      if (!parsed) break;
      // Only the final step speaks: words written while a tool is still running are not shown.
      if (!parsed.action) {
        says.push(...parsed.say);
        break;
      }
      const v = validateAction(parsed.action);
      const callId = `call_${next++}`;
      messages.push({ role: "assistant", content: out.text.slice(0, 2000) });
      if (!v.ok) {
        refused.push(v.name);
        results[callId] = { error: v.error };
        await addLog(ctx, { kind: "tool", tool: v.name || "(none)", callId, note: `refused: ${v.error}` });
      } else if (v.tool.organiserOnly && speaker.role !== "organiser") {
        refused.push(v.tool.name);
        results[callId] = { error: `${v.tool.name} is for the organiser` };
        await addLog(ctx, { kind: "tool", tool: v.tool.name, callId, note: "refused: organiser only" });
      } else {
        let r: Record<string, unknown>;
        try {
          r = await v.tool.run(ctx, speaker, v.args);
        } catch (e) {
          r = { error: "that did not work" };
        }
        results[callId] = r;
        await addLog(ctx, { kind: "tool", tool: v.tool.name, callId, note: summarise(r) });
      }
      if (steps < MAX_STEPS_PER_TURN) messages.push({ role: "user", content: `${callId}: ${JSON.stringify(results[callId]).slice(0, 3000)}` });
    }
  } catch (e) {
    if (e instanceof TreasurerResting) { resting = e.why; restingKind = e.kind; }
    else throw e;
  }

  const targeted: Say[] = [];
  for (const s of says) {
    const to = allowedTarget(speaker, s.to);
    if (to) targeted.push({ ...s, to });
    else await addLog(ctx, { kind: "drop", note: `dropped: addressed to ${s.to.slice(0, 40)}, not to the person writing` });
  }
  const speakerName = speaker.role === "member" ? memberById(c, speaker.memberId)?.name : undefined;
  const checked = applyDropRule(targeted, results, c.members.map((m) => m.name), { speakerName });
  for (const d of checked.dropped) {
    await addLog(ctx, { kind: "drop", note: `dropped: not backed by a tool result ("${d.token}")${d.clause ? ` in "${d.clause}"` : ""}` });
  }
  let privacyDrops = 0;
  const privateChecked: Say[] = [];
  for (const s of checked.kept) {
    const remaining: string[] = [];
    for (const sentence of splitSentences(s.text)) {
      if (privateMemberClaim(c, s.to, sentence)) {
        privacyDrops++;
        await addLog(ctx, { kind: "drop", note: "dropped: privacy, a member's amount in a group message" });
      } else remaining.push(sentence);
    }
    if (remaining.length) privateChecked.push({ ...s, text: remaining.join(" ") });
  }
  // A sentence said in two steps reaches the person once.
  const seen = new Set<string>();
  let kept = privateChecked.filter((s) => {
    const key = `${s.to}|${s.text.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (kept.length === 0) {
    kept = [{ to: speakerTarget(speaker), text: restingKind === "demo" ? DEMO_ONLY[lang] : restingKind === "site_off" ? SITE_OFF[lang] : restingKind === "daily_cap" ? RESTING[lang] : FALLBACK[lang], refs: [] }];
  }
  const said: Msg[] = [];
  for (const s of kept) {
    said.push(await addMsg(ctx, { to: s.to, from: "treasurer", text: s.text, kind: "chat", recorded, refs: s.refs }));
  }
  if (resting) await addLog(ctx, { kind: "rule", note: `treasurer resting: ${resting}` });
  return { said, dropped: checked.dropped.length + privacyDrops, steps, refused, neurons: Math.round(neurons * 100) / 100, recorded, resting };
}

function summarise(r: Record<string, unknown>): string {
  if (r.error) return `error: ${r.error}`;
  if (Array.isArray(r.partners)) return `${r.partners.length} partners`;
  if (r.status) return String(r.status);
  if (r.potStatus) return `pot ${r.potStatus}`;
  return "ok";
}
