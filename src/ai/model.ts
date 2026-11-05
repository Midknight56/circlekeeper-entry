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

/** Keeps the system prompt and the newest messages, dropping the oldest until the prompt fits MAX_INPUT_CHARS. */
export function fitMessages(messages: ChatMessage[]): ChatMessage[] {
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
    const last = fitted[fitted.length - 1];
    if (last && last.role === "user") fitted[fitted.length - 1] = { ...last, content: last.content + " /no_think" };
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
