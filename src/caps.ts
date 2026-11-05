// Every cap, with the arithmetic that keeps a free visitor at $0 beside it.
//
// Workers AI on the Workers Free plan: "a total of 10,000 Neurons per day at no charge", and past it "further operations
// will fail with an error" (developers.cloudflare.com/workers-ai/platform/pricing, read 23 Oct 2026). So the worst case
// is an error, never a bill. The 10,000 is for the WHOLE ACCOUNT, shared by every hackathon app on it, so this app keeps
// its own slice and charges each call BEFORE it runs.
//
// Model @cf/qwen/qwen3-30b-a3b-fp8: 4,625 neurons per million input tokens, 30,475 per million output tokens (same page).

export const MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8";
export const NEURONS_PER_INPUT_TOKEN = 4625 / 1_000_000;
export const NEURONS_PER_OUTPUT_TOKEN = 30475 / 1_000_000;

// About 2,000 tokens at 4 characters a token: 2,000 x 4,625 / 1,000,000 = 9.25 neurons.
export const MAX_INPUT_CHARS = 8000;
// 400 x 30,475 / 1,000,000 = 12.19 neurons. Worst case call: 9.25 + 12.19 = 21.44 neurons.
export const MAX_OUTPUT_TOKENS = 400;

// This app's slice of the account's 10,000: 700 / 21.44 = 32 worst case calls a day. Raise only when the account
// allocation is re-split (PLAN.md section 3).
export const DAILY_NEURONS = 700;
// A second guard over every app on the account: this app refuses a call when the whole ledger for the day would pass
// 9,500, leaving 500 of the free 10,000 as slack for the other apps' own in-flight calls.
export const ACCOUNT_DAILY_NEURONS_GUARD = 9500;

// 6 x 21.44 = 128.6 neurons for one visitor at most, 18% of this app's slice.
export const MAX_AI_CALLS_PER_VISITOR_DAY = 6;
// One user turn is at most 4 model calls: 4 x 21.44 = 85.8 neurons.
export const MAX_STEPS_PER_TURN = 4;

// PayPal sandbox calls move test money only and cost $0 ("the free sandbox environment", contest rules).
// These caps protect the shared sandbox merchant and the free Durable Object row budget (100,000 rows written a day on
// the Free plan; past it further operations fail with an error; resets at 00:00 UTC
// (developers.cloudflare.com/durable-objects/platform/pricing, page last updated Oct 18 2026, read 2 Nov 2026)).
export const MAX_CIRCLES_PER_VISITOR_DAY = 10; // demo copies count too
// One network's worst day, measured 2 Nov 2026 with a counter on every Durable Object write in real local runs: a
// circle only made is 8 rows, a plain round is 167, the heaviest round (split, swap, card, payout) is 304.
// 10 x 304 = 3,040 rows, 3.0% of the free 100,000, so 32 such networks fit in a day. The whole account's busiest
// real day so far is 1,742 rows (2 Nov 2026 by 05:30 UTC, Cloudflare's analytics). Past the free rows a write fails
// with an error, not a bill, and each AI call stays under MAX_AI_CALLS_PER_VISITOR_DAY, so more circles add no neurons.
// One network may send 3 live pots a day: 3 x $600 = $1,800, so one network cannot empty the $6,000 day cap below.
export const MAX_LIVE_POTS_PER_VISITOR_DAY = 3;
export const MAX_PAYPAL_WRITES_PER_CIRCLE_DAY = 80; // a full round with a split and a payout is about 30
export const MAX_PAYPAL_WRITES_PER_DAY = 1000;
export const DAILY_CAP_TEXT = "Today's limit for PayPal calls is reached. Try again after 00:00 UTC.";
// The pot is paid from the one sandbox merchant all five hackathon apps share. $6,000 a day of sandbox money is
// ten $600 pots.
export const MAX_PAYOUT_CENTS_PER_DAY = 600_000;
// A visitor's own circle: at most 6 members (we have six sandbox personas) and at most $100 a share.
export const MAX_MEMBERS = 6;
export const MAX_SHARE_CENTS = 10_000;

export function worstCaseNeurons(inputChars: number, maxTokens: number): number {
  const inputTokens = Math.ceil(Math.min(inputChars, MAX_INPUT_CHARS) / 4);
  return round2(inputTokens * NEURONS_PER_INPUT_TOKEN + Math.min(maxTokens, MAX_OUTPUT_TOKENS) * NEURONS_PER_OUTPUT_TOKEN);
}

export function neuronsFor(inputTokens: number, outputTokens: number): number {
  return round2(inputTokens * NEURONS_PER_INPUT_TOKEN + outputTokens * NEURONS_PER_OUTPUT_TOKEN);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
