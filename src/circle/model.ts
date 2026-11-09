// The circle's records. Amounts are integer cents. Every record lives in one circle's store.

import type { Need, Slot } from "./solver";

export type Lang = "en" | "es" | "fr";

export interface Member {
  id: string;
  name: string;
  lang: Lang;
  slot: number; // which sandbox persona pays and receives for this member (1 to 6)
  token: string; // the member's private link key
}

export interface Rules {
  privacy: boolean; // group messages never name an amount owed by one member
  shortShare: { allowed: boolean; minNowCents: number; laterDays: number };
  missed: { graceDays: number; action: "move_to_end" | "pot_waits" };
  confirmers: string[]; // two member ids who confirm each pot release
}

export interface Circle {
  id: string;
  name: string;
  currency: "USD";
  shareCents: number;
  startMonth: string;
  payDay: number;
  members: Member[];
  needs: Need[];
  rules: Rules;
  rotation: Slot[];
  organiserToken: string;
  status: "draft" | "active" | "done";
  demo: boolean;
  createdAt: string;
  version: number;
  unused?: string[]; // sentences the words reader did not use; shown to the organiser before Start
  unusedAccepted?: string[]; // exact omitted text explicitly accepted by the organiser
  brokenNeeds?: string[]; // needs the rotation could not meet; kept after Start
}

export type PartStatus = "DRAFT" | "SENT" | "UNPAID" | "PAID" | "MARKED_AS_PAID" | "CANCELLED" | "PAYER_ACTION" | "COMPLETED";

export interface SharePart {
  invoiceId?: string;
  orderId?: string;
  orderState?: "creating" | "payable" | "capturing" | "unknown" | "captured" | "closed";
  orderApproveUrl?: string;
  orderRequest?: { id: string; body: string; method: "PAYPAL" | "CARD" };
  captureId?: string;
  capturedCents?: number;
  capturedAt?: string;
  recordPending?: boolean;
  recordMethod?: "PAYPAL" | "CARD";
  cents: number;
  dueDate: string;
  status: PartStatus;
  requestId: string;
  number: string; // CK-<circle>-<round>-<member>[-a|-b]
  payerUrl?: string;
  paidAt?: string;
  checkedAt?: string; // last fresh GET from PayPal
  paymentMethod?: "PAYPAL" | "CARD" | "CASH_RECORD";
}

export interface Share {
  recoveryError?: string;
  round: number;
  memberId: string;
  parts: SharePart[];
  reminders: { at: string; reason: string; tone: string; invoiceId: string; sent: boolean }[];
}

export interface Confirmation {
  memberId: string;
  at: string;
}

export interface Pot {
  round: number;
  recipientId: string;
  cents: number;
  status: "waiting" | "drafted" | "paying" | "paid" | "failed";
  confirmations: Confirmation[];
  senderBatchId: string;
  requestId: string;
  payoutBatchId?: string;
  sentBy?: "main";
  sendTries?: number;
  lastSendAt?: string;
  batchStatus?: string;
  itemStatus?: string;
  refusal?: string;
  paidAt?: string;
  waitUntil?: string;
  liveSlotDay?: string;
}

export interface MissedPlan {
  action: "move_to_end" | "pot_waits";
  turns?: { round: number; memberId: string; fromMemberId: string }[];
  waitUntil?: string;
}

export interface Missed {
  id: string;
  round: number;
  memberId: string;
  action: "move_to_end" | "pot_waits";
  consents: Record<string, "yes" | "no">;
  status: "asked" | "applied" | "declined";
  createdAt: string;
  plan: MissedPlan;
  reason?: string;
}

export interface SwapNeedInfo {
  memberId: string;
  name: string;
  text: string;
}

export interface SwapReason {
  fromMonth: string;
  toMonth: string;
  fromNow: string;
  toNow: string;
  needsKept: SwapNeedInfo[];
  conflict?: SwapNeedInfo;
  consenters: string[];
}

export interface Swap {
  id: string;
  from: string;
  to: string;
  fromRound: number;
  toRound: number;
  consents: Record<string, "yes" | "no">;
  status: "asked" | "applied" | "declined" | "stale";
  createdAt: string;
  appliedAt?: string;
  reason?: string;
  requestRound?: number;
  why?: SwapReason;
}

export interface Split {
  id: string;
  round: number;
  memberId: string;
  nowCents: number;
  laterCents: number;
  dueDate: string;
  consent?: "yes" | "no";
  status: "proposed" | "pending" | "applied" | "declined" | "failed";
  createdAt: string;
}

export interface Msg {
  id: string;
  to: string; // "group" or "member:<id>" or "organiser"
  from: string; // "treasurer", "organiser" or a member id
  text: string;
  at: string;
  kind: "chat" | "reminder" | "ask" | "notice";
  recorded?: boolean; // played from the recorded demo run
  refs?: string[];
}

export interface LogEntry {
  at: string;
  kind: "paypal" | "model" | "tool" | "drop" | "rule" | "webhook" | "schedule";
  method?: string;
  path?: string;
  status?: number;
  ids?: string[];
  debugId?: string;
  errorName?: string;
  tool?: string;
  note?: string;
  neurons?: number;
  callId?: string;
  recorded?: boolean;
  raw?: string; // a model step's raw answer, kept only in local recording runs (DEV_ROUTES=1)
}

// The storage a circle's logic uses. A Durable Object's storage fits it; tests use MemoryStore.
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(opts: { prefix: string }): Promise<Map<string, T>>;
}

export class MemoryStore implements Store {
  data = new Map<string, unknown>();
  writes = 0;
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.writes++;
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async list<T>(opts: { prefix: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const k of [...this.data.keys()].sort()) {
      if (k.startsWith(opts.prefix)) out.set(k, structuredClone(this.data.get(k)) as T);
    }
    return out;
  }
}

export const keys = {
  circle: () => "circle",
  share: (round: number, memberId: string) => `share:${pad(round)}:${memberId}`,
  sharesOfRound: (round: number) => `share:${pad(round)}:`,
  pot: (round: number) => `pot:${pad(round)}`,
  swap: (id: string) => `swap:${id}`,
  missed: (id: string) => `missed:${id}`,
  split: (id: string) => `split:${id}`,
  msg: (at: string, id: string) => `msg:${at}:${id}`,
  log: (at: string, n: string) => `log:${at}:${n}`,
};

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function partPaid(p: SharePart): boolean {
  return p.status === "PAID" || p.status === "MARKED_AS_PAID" || p.status === "COMPLETED";
}

export function shareFullyPaid(s: Share | undefined, cents: number): boolean {
  const live = (s?.parts || []).filter((p) => p.status !== "CANCELLED");
  return live.length > 0 && live.every((p) => p.invoiceId && !p.recordPending && partPaid(p) && Number.isSafeInteger(p.cents) && p.cents > 0) &&
    new Set(live.map((p) => p.invoiceId)).size === live.length && live.reduce((sum, p) => sum + p.cents, 0) === cents;
}

export function shareState(s: Share | undefined, cents: number): "none" | "sent" | "paid" | "partial" | "cancelled" {
  if (!s || s.parts.length === 0) return "none";
  const live = s.parts.filter((p) => p.status !== "CANCELLED");
  if (live.length === 0) return "cancelled";
  const paid = live.filter(partPaid).length;
  if (shareFullyPaid(s, cents)) return "paid";
  return paid > 0 ? "partial" : "sent";
}

export function memberById(c: Circle, id: string): Member | undefined {
  return c.members.find((m) => m.id === id);
}

export function recipientOf(c: Circle, round: number): string | undefined {
  return c.rotation.find((s) => s.round === round)?.memberId;
}

export function roundOf(c: Circle, memberId: string): number | undefined {
  return c.rotation.find((s) => s.memberId === memberId)?.round;
}

export function newId(len = 10): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}
