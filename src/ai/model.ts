// The model behind the treasurer, behind one interface: Workers AI live, a recorded run for the demo, a script in tests.

import { ACCOUNT_DAILY_NEURONS_GUARD, DAILY_NEURONS, MAX_INPUT_CHARS, MAX_OUTPUT_TOKENS, MODEL_ID, neuronsFor, worstCaseNeurons } from "../caps";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
  neurons: number;
  recorded: boolean;
}

export interface Model {
  complete(messages: ChatMessage[], maxTokens: number): Promise<Completion>;
}

export type RestingReason = "daily_cap" | "site_off" | "demo" | "unavailable";

export class TreasurerResting extends Error {
  constructor(public why: string, public kind: RestingReason = "daily_cap") {
    super(why);
  }
}

// The day's neuron ledger. Live: the shared D1 database `hackathon-ledger` (or this app's own Hub until it exists).
export interface NeuronLedger {
  /** Charges `neurons` before a call if both the app's slice and the account guard allow it; returns a charge id. */
  charge(app: string, day: string, neurons: number, appLimit: number, accountLimit: number): Promise<string | null>;
  /** Replaces the worst case charge with what the call really used. */
  settle(id: string, neurons: number): Promise<void>;
  spent(app: string, day: string): Promise<number>;
}

export const APP = "circlekeeper";

/** Keeps the system prompt, first user message, and newest messages within MAX_INPUT_CHARS. */
export function fitMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) {
    const [first, ...rest] = messages;
    const kept = [...rest];
    const size = () => (first?.content.length ?? 0) + kept.reduce((n, m) => n + m.content.length, 0);
    while (kept.length > 1 && size() > MAX_INPUT_CHARS) kept.shift();
    let out = first ? [first, ...kept] : kept;
    if (size() > MAX_INPUT_CHARS) {
      const over = size() - MAX_INPUT_CHARS;
      const last = out[out.length - 1];
      out = [...out.slice(0, -1), { ...last, content: last.content.slice(0, Math.max(0, last.content.length - over)) }];
    }
    return out;
  }

  let out = [...messages];
  const size = () => out.reduce((n, message) => n + message.content.length, 0);
  while (out.length > 4 && size() > MAX_INPUT_CHARS) out.splice(2, 1);
  if (size() <= MAX_INPUT_CHARS) return out;

  const marker = " ...(cut)";
  const firstUser = out[1].content;
  const firstLineEnd = firstUser.indexOf("\n");
  const secondLineEnd = firstLineEnd < 0 ? -1 : firstUser.indexOf("\n", firstLineEnd + 1);
  const hasSpeakerHeader = firstUser.startsWith("Writing to you:") && firstUser.slice(firstLineEnd + 1).startsWith("Message:");
  const protectedUserLength = !hasSpeakerHeader ? 0 : secondLineEnd < 0 ? firstUser.length : secondLineEnd + 1;
  while (size() > MAX_INPUT_CHARS) {
    let cutIndex = -1;
    for (let i = 1; i < out.length; i++) {
      const minimum = i === 1 ? protectedUserLength + marker.length : marker.length;
      if (out[i].content.length <= minimum) continue;
      if (cutIndex < 0 || out[i].content.length > out[cutIndex].content.length) cutIndex = i;
    }
    if (cutIndex < 0) {
      if (out[0].content.length <= marker.length) break;
      cutIndex = 0;
    }
    const cut = out[cutIndex];
    const minimumContentLength = cutIndex === 1 ? protectedUserLength : 0;
    const alreadyMarked = cut.content.endsWith(marker);
    const raw = alreadyMarked ? cut.content.slice(0, -marker.length) : cut.content;
    const removable = Math.max(0, raw.length - minimumContentLength);
    const remove = Math.min(removable, size() - MAX_INPUT_CHARS + (alreadyMarked ? 0 : marker.length));
    const content = raw.slice(0, Math.max(minimumContentLength, raw.length - remove)) + marker;
    out[cutIndex] = { ...cut, content };
  }
  return out;
}

function asText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  return JSON.stringify(raw);
}

export function cleanReply(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
}

export class WorkersAiModel implements Model {
  constructor(
    private ai: { run(model: string, input: unknown): Promise<unknown> },
    private ledger: NeuronLedger,
    private day: () => string,
  ) {}

  async complete(messages: ChatMessage[], maxTokens: number): Promise<Completion> {
    const fitted = fitMessages(messages);
    const chars = fitted.reduce((n, m) => n + m.content.length, 0);
    const cap = Math.min(maxTokens, MAX_OUTPUT_TOKENS);
    const worst = worstCaseNeurons(chars, cap);
    const charge = await this.ledger.charge(APP, this.day(), worst, DAILY_NEURONS, ACCOUNT_DAILY_NEURONS_GUARD);
    if (!charge) throw new TreasurerResting("the day's free model budget is used up");
    let out: any;
    try {
      out = await this.ai.run(MODEL_ID, { messages: fitted, max_tokens: cap, temperature: 0.2 });
    } catch (e) {
      await this.ledger.settle(charge, 0);
      throw new TreasurerResting("the model did not answer", "unavailable");
    }
    const usage = out?.usage || {};
    const inputTokens = Number(usage.prompt_tokens ?? Math.ceil(chars / 4));
    const outputTokens = Number(usage.completion_tokens ?? cap);
    // Workers AI reports the neurons it charged (usage.neurons); fall back to the price list arithmetic.
    const neurons = Number.isFinite(Number(usage.neurons)) ? Math.round(Number(usage.neurons) * 100) / 100 : neuronsFor(inputTokens, outputTokens);
    await this.ledger.settle(charge, neurons);
    return {
      text: cleanReply(asText(out?.response ?? out?.choices?.[0]?.message?.content ?? "")),
      inputTokens,
      outputTokens,
      neurons,
      recorded: false,
    };
  }
}

/** Plays a recorded run: the same answers the live model gave when the demo was recorded. Costs 0 neurons. */
export class RecordedModel implements Model {
  private i = 0;
  constructor(private steps: string[]) {}
  async complete(): Promise<Completion> {
    const text = this.steps[Math.min(this.i, this.steps.length - 1)] ?? '{"action":null,"say":[]}';
    this.i++;
    return { text, inputTokens: 0, outputTokens: 0, neurons: 0, recorded: true };
  }
  get calls(): number {
    return this.i;
  }
}

/** Counts per visitor; the Hub keeps them. */
export interface VisitorCaps {
  take(visitor: string, day: string, what: "ai" | "circle", limit: number): Promise<boolean>;
}

/** A model that also enforces the visitor's daily call cap before each call. */
export class CappedModel implements Model {
  constructor(
    private inner: Model,
    private caps: VisitorCaps,
    private visitor: string,
    private day: () => string,
    private limit: number,
  ) {}
  async complete(messages: ChatMessage[], maxTokens: number): Promise<Completion> {
    if (!(await this.caps.take(this.visitor, this.day(), "ai", this.limit))) {
      throw new TreasurerResting("this visitor's model calls for today are used up");
    }
    return this.inner.complete(messages, maxTokens);
  }
}
