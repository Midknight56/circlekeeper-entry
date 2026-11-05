// A whole circle in memory: a store, a hub, a fake sandbox and a clock. Tests drive the real logic through it.
import { PayPal } from "../../src/paypal/client";
import type { Ctx, Hub } from "../../src/circle/context";
import { wirePayPalLog } from "../../src/circle/context";
import { MemoryStore, type Circle, type Member } from "../../src/circle/model";
import { solveRotation } from "../../src/circle/solver";
import { sandbox } from "./sandbox";

export class MemoryHub implements Hub {
  idx = new Map<string, string>();
  events = new Set<string>();
  async index(kind: string, id: string, circleId: string) {
    this.idx.set(`${kind}:${id}`, circleId);
  }
  async lookup(kind: string, id: string) {
    return this.idx.get(`${kind}:${id}`);
  }
  async firstSeen(eventId: string) {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
}

export const NAMES: [string, string, "en" | "es" | "fr"][] = [
  ["keisha", "Keisha", "en"],
  ["marisol", "Marisol", "es"],
  ["dana", "Dana", "en"],
  ["theo", "Theo", "en"],
  ["amelie", "Amélie", "fr"],
  ["sam", "Sam", "en"],
];

export function sixMembers(): Member[] {
  return NAMES.map(([id, name, lang], i) => ({ id, name, lang, slot: i + 1, token: "tok-" + id }));
}

export async function world(opts: { members?: number; clock?: string } = {}) {
  const sb = sandbox();
  const store = new MemoryStore();
  const hub = new MemoryHub();
  let now = new Date(opts.clock || "2026-12-01T15:00:00Z");
  const env = { CK: undefined as unknown as KVNamespace, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const tokenStore = new Map<string, string>();
  env.CK = {
    get: async (k: string) => (tokenStore.has(k) ? JSON.parse(tokenStore.get(k)!) : null),
    put: async (k: string, v: string) => {
      tokenStore.set(k, v);
    },
    delete: async (k: string) => {
      tokenStore.delete(k);
    },
  } as unknown as KVNamespace;
  PayPal.resetMemory();
  const pp = new PayPal(env, sb.fetchFn, () => now.getTime(), async () => {});
  const ctx: Ctx = {
    circleId: "c1",
    store,
    pp,
    hub,
    personas: { merchant: "merchant@test", members: ["m1@test", "m2@test", "m3@test", "m4@test", "m5@test", "m6@test"] },
    now: () => now,
    realNow: () => now,
    baseUrl: "https://ck.test",
  };
  wirePayPalLog(ctx);
  const members = sixMembers().slice(0, opts.members ?? 6);
  const solved = solveRotation({
    memberIds: members.map((m) => m.id),
    startMonth: "2026-12",
    needs: [{ memberId: "keisha", kind: "want", month: "2027-02" }],
  });
  const circle: Circle = {
    id: "c1",
    name: "Test circle",
    currency: "USD",
    shareCents: 10000,
    startMonth: "2026-12",
    payDay: 15,
    members,
    needs: [{ memberId: "keisha", kind: "want", month: "2027-02" }],
    rules: { privacy: true, shortShare: { allowed: true, minNowCents: 5000, laterDays: 14 }, missed: { graceDays: 3, action: "move_to_end" }, confirmers: ["dana", "theo"] },
    rotation: solved.rotation,
    organiserToken: "org",
    status: "draft",
    demo: false,
    createdAt: now.toISOString(),
    version: 1,
  };
  await store.put("circle", circle);
  return {
    ctx,
    sb,
    store,
    hub,
    circle,
    setNow(iso: string) {
      now = new Date(iso);
    },
    async load(): Promise<Circle> {
      return (await store.get<Circle>("circle"))!;
    },
  };
}

/** The demo circle itself, in memory, with the fake sandbox. */
export async function demoWorld() {
  const { draftCircle } = await import("../../src/circle/create");
  const { DEMO_TEXT, DEMO_START_MONTH } = await import("../../src/demo");
  const w = await world();
  const draft = draftCircle(DEMO_TEXT, "2026-11-20", { id: "c1", demo: true, startMonth: DEMO_START_MONTH });
  await w.store.put("circle", draft.circle!);
  return { ...w, circle: draft.circle! };
}
