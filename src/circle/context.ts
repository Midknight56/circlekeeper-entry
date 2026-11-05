// What a circle's logic needs from the outside world. The Durable Object builds one per request; tests build fakes.

import type { PayPal } from "../paypal/client";
import type { LogEntry, Store } from "./model";

export interface Personas {
  merchant: string; // the invoicer and the payout sender
  members: string[]; // sandbox personal accounts; member slot n uses members[(n - 1) % length]
}

// The one place that knows which circle owns a PayPal id, and which webhook events were already handled.
export interface Hub {
  index(kind: "inv" | "batch" | "order", id: string, circleId: string): Promise<void>;
  lookup(kind: "inv" | "batch" | "order", id: string): Promise<string | undefined>;
  firstSeen(eventId: string): Promise<boolean>; // true the first time, false after
  /** Counts a pot against the day's sandbox payout cap; false refuses it. */
  takePayout?(day: string, cents: number, limit: number): Promise<boolean>;
  takeLivePot?(visitor: string, day: string, limit: number): Promise<boolean>;
}

export interface Ctx {
  circleId: string;
  store: Store;
  pp: PayPal;
  payoutPp?: PayPal; // the older app paid pots until 2 Nov and now only reads batches it already sent
  visitor?: string;
  sendPp?: PayPal; // local only: separate PayPal app for small test payouts
  sendCents?: number; // local only: amount sent while the pot record keeps its real amount
  noLocalSend?: boolean; // local only: refuse when the test payout app is not configured
  hub: Hub;
  personas: Personas;
  now: () => Date;
  /** Wall clock for daily limits; unlike now(), this is never shifted by demoClock. */
  realNow: () => Date;
  baseUrl: string;
  captureRaw?: boolean; // local recording runs only
  quiet?: boolean; // background refresh: its successful reads stay out of the tool panel
}

export function personaEmail(p: Personas, slot: number): string {
  if (p.members.length === 0) throw new Error("no sandbox member personas configured");
  return p.members[(Math.max(1, slot) - 1) % p.members.length];
}

export function today(ctx: Ctx): string {
  return ctx.now().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let logSeq = 0;

export async function addLog(ctx: Ctx, entry: Omit<LogEntry, "at">): Promise<void> {
  const at = ctx.now().toISOString();
  logSeq = (logSeq + 1) % 100000;
  await ctx.store.put(`log:${at}:${String(logSeq).padStart(5, "0")}`, { at, ...entry });
}

// Every PayPal call this circle makes lands in its tool panel: method, path, code, ids. Never a token.
export function wirePayPalLog(ctx: Ctx): void {
  for (const pp of [ctx.pp, ctx.payoutPp]) if (pp) wireOne(ctx, pp);
}

function wireOne(ctx: Ctx, pp: PayPal): void {
  pp.onCall = async (rec) => {
    if (ctx.quiet && rec.method === "GET" && rec.status >= 200 && rec.status < 300) return;
    const inPath = [...rec.path.matchAll(/(INV2-[A-Z0-9-]+|[A-Z0-9]{13,17})/g)].map((m) => m[1]);
    const ids = [...new Set([...inPath, ...(rec.ids || [])])];
    await addLog(ctx, {
      kind: "paypal",
      method: rec.method,
      path: rec.path,
      status: rec.status,
      ids,
      debugId: rec.debugId,
      errorName: rec.errorName,
    });
  };
}
