import { MAX_CIRCLES_PER_VISITOR_DAY, utcDay } from "./caps";
import { CircleDO, hubOf, type Out } from "./circle/circle-do";
import { draftCircle } from "./circle/create";
import type { Hub } from "./circle/context";
import { DEMO_START_MONTH, DEMO_TEXT } from "./demo";
import { HubDO } from "./hub";
import { PayPal } from "./paypal/client";
import { routeEvent } from "./paypal/router";
import { handleWebhook } from "./paypal/webhooks";

export { CircleDO, HubDO };

export interface Env {
  CK: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  HUB: DurableObjectNamespace<HubDO>;
  CIRCLE: DurableObjectNamespace<CircleDO>;
  LEDGER?: D1Database;
  BUILD_TAG: string;
  PAYPAL_BASE: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_WEBHOOK_ID: string;
  // Circlekeeper's own funded sandbox app pays the pot; the shared app keeps the invoices (docs/DECISIONS.md).
  PAYPAL_PAYOUT_CLIENT_ID?: string;
  PAYPAL_PAYOUT_CLIENT_SECRET?: string;
  PAYPAL_PAYOUT_WEBHOOK_ID?: string;
  PAYPAL_PERSONAS: string; // JSON {"merchant": "...", "members": ["...", ...]}, a secret
  VISITOR_SALT?: string;
  LIVE_AI: string; // "1" lets a visitor's own circle call the model, behind the caps
  DEV_ROUTES: string;
  LOCAL_CIRCLE_CAP?: string;
  LOCAL_AI_CAP?: string;
  LOCAL_PAYPAL_WRITE_CAP?: string;
  LOCAL_PAYOUT_CAP_CENTS?: string;
  LOCAL_POT_CLIENT_ID?: string;
  LOCAL_POT_CLIENT_SECRET?: string;
  LOCAL_POT_SEND_CENTS?: string;
  LOCAL_LIVE_POT_CAP?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function payoutPayPal(env: Env): PayPal | undefined {
  if (!env.PAYPAL_PAYOUT_CLIENT_ID || !env.PAYPAL_PAYOUT_CLIENT_SECRET) return undefined;
  return new PayPal({ ...env, PAYPAL_CLIENT_ID: env.PAYPAL_PAYOUT_CLIENT_ID, PAYPAL_CLIENT_SECRET: env.PAYPAL_PAYOUT_CLIENT_SECRET });
}

function circleStub(env: Env, id: string) {
  return env.CIRCLE.get(env.CIRCLE.idFromName(id));
}

/** A visitor is a SHA-256 of the connecting address and the day, with a salt. The address itself is never stored. */
async function visitorOf(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const data = new TextEncoder().encode(`${env.VISITOR_SALT || "ck"}|${utcDay(new Date())}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const t = await req.text();
    if (t.length > 8000) return { __invalidJson: true };
    const parsed = JSON.parse(t || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { __invalidJson: true };
  } catch {
    return { __invalidJson: true };
  }
}

function validPostBody(parts: string[], body: Record<string, any>): boolean {
  let fields: Record<string, "string" | "object" | "number">;
  if (parts[1] === "circles" && parts.length === 2) fields = { text: "string" };
  else if (parts[1] === "demo" && parts.length === 2) fields = {};
  else if (parts[1] === "circles" && parts.length >= 4) {
    const route = parts[3];
    if (route === "start" || route === "guard") fields = { k: "string" };
    else if (route === "rules" && parts.length === 4) fields = { k: "string", rules: "object" };
    else if (route === "member" && parts.length === 5 && parts[4] === "split") fields = { k: "string", nowCents: "number" };
    else if (route === "member" && parts.length === 5 && parts[4] === "swap") fields = { k: "string", to: "string" };
    else if (route === "member" && parts.length === 5 && parts[4] === "partners") fields = { k: "string" };
    else if (route === "chat") fields = { k: "string", text: "string" };
    else if (route === "swaps" && parts.length === 4) fields = { k: "string", from: "string", to: "string" };
    else if (route === "swaps" && parts.length === 6 && parts[5] === "consent") fields = { k: "string", answer: "string" };
    else if (route === "missed" && parts.length === 5 && parts[4] === "check") fields = { k: "string" };
    else if (route === "demo" && parts.length === 5 && parts[4] === "skip-to-wait") fields = { k: "string" };
    else if (route === "missed" && parts.length === 6 && parts[5] === "consent") fields = { k: "string", answer: "string" };
    else if (route === "whatif" && parts.length === 4) fields = { k: "string", change: "object" };
    else if (route === "whatif" && parts.length === 5 && parts[4] === "clear") fields = { k: "string" };
    else if (route === "splits" && parts[5] === "retry") fields = { k: "string" };
    else if (route === "splits") fields = { k: "string", answer: "string" };
    else if (route === "rounds" && parts[5] === "release" && (parts[6] === "confirm" || parts[6] === "retry")) fields = { k: "string" };
    else if (route === "shares" && parts[6] === "cash") fields = { k: "string" };
    else if (route === "shares" && (parts[6] === "card" || parts[6] === "order")) fields = { k: "string", part: "string" };
    else return true; // normal route resolution returns 404
  } else return true;
  if (Object.keys(body).some((key) => !Object.prototype.hasOwnProperty.call(fields, key))) return false;
  return Object.entries(body).every(([key, value]) => typeof value === fields[key]);
}

async function newCircle(req: Request, env: Env, text: string, demo: boolean): Promise<Response> {
  const visitor = await visitorOf(req, env);
  const hub = hubOf(env);
  // Local test runs may raise the cap in .dev.vars; the deployed Worker has no such value and keeps the constant.
  const cap = Number(env.LOCAL_CIRCLE_CAP) || MAX_CIRCLES_PER_VISITOR_DAY;
  if (!(await hub.take(`v:${visitor}:${utcDay(new Date())}:circle`, cap))) {
    return json({ ok: false, error: "You have made today's circles. Come back tomorrow, or use one you made." }, 429);
  }
  const draft = draftCircle(text, utcDay(new Date()), { demo, startMonth: demo ? DEMO_START_MONTH : undefined });
  if (!draft.circle) return json({ ok: false, error: draft.error, notes: draft.notes }, 400);
  const c = draft.circle;
  const base = new URL(req.url).origin;
  const stub = circleStub(env, c.id);
  await stub.create(c);
  await hub.registerCircle(c.id, demo);
  await stub.setup(base, text, visitor);
  return json({
    ok: true,
    id: c.id,
    organiserToken: c.organiserToken,
    organiserUrl: `/c/${c.id}?k=${c.organiserToken}`,
    memberLinks: c.members.map((m) => ({ memberId: m.id, name: m.name, url: `/m/${c.id}/${m.token}` })),
    notes: draft.notes,
    broken: draft.broken,
  });
}

function hubApi(env: Env): Hub {
  const hub = hubOf(env);
  return {
    index: (kind, id, cid) => hub.index(kind, id, cid),
    lookup: (kind, id) => hub.lookup(kind, id),
    firstSeen: (id) => hub.firstSeen(id),
  };
}

async function api(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const base = url.origin;
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  if (method === "POST" && parts[1] === "circles" && parts.length === 2) {
    const body = await readJson(req);
    if (!validPostBody(parts, body)) return json({ ok: false, error: "Invalid request." }, 400);
    return newCircle(req, env, String(body.text || ""), false);
  }
  if (method === "POST" && parts[1] === "demo" && parts.length === 2) {
    const body = await readJson(req);
    if (!validPostBody(parts, body)) return json({ ok: false, error: "Invalid request." }, 400);
    return newCircle(req, env, DEMO_TEXT, true);
  }
  if (method === "GET" && parts[1] === "orders" && parts[2] === "return") {
    const cid = url.searchParams.get("c") || "";
    const orderId = url.searchParams.get("token") || "";
    if (!cid || !orderId) return Response.redirect(`${base}/`, 302);
    const out = (await circleStub(env, cid).orderReturn(base, orderId)) as unknown as Out;
    const path = (out.body.memberPath as string) || "/";
    return Response.redirect(`${base}${path}${out.status === 200 ? "" : "?order=pending"}`, 302);
  }
  if (parts[1] !== "circles" || parts.length < 4) return json({ ok: false, error: "not found" }, 404);

  const id = parts[2];
  const stub = circleStub(env, id);
  if (method === "GET" && parts[3] === "state") {
    const out = (await stub.state(base, url.searchParams.get("k") || "")) as unknown as Out;
    return json(out.body, out.status);
  }
  if (method !== "POST") return json({ ok: false, error: "not found" }, 404);
  const body = await readJson(req);
  if (!validPostBody(parts, body)) return json({ ok: false, error: "Invalid request." }, 400);
  const k = String(body.k || "");
  let out: Out | undefined;
  if (parts[3] === "start") out = (await stub.start(base, k)) as unknown as Out;
  else if (parts[3] === "rules" && parts.length === 4) out = (await stub.updateRules(k, body.rules)) as unknown as Out;
  else if (parts[3] === "guard" && parts.length === 4) out = (await stub.guard(base, k)) as unknown as Out;
  else if (parts[3] === "member" && parts.length === 5 && ["split", "swap", "partners"].includes(parts[4])) out = (await stub.memberAction(base, k, parts[4], body)) as unknown as Out;
  else if (parts[3] === "chat") out = (await stub.chat(base, k, String(body.text || ""), await visitorOf(req, env))) as unknown as Out;
  else if (parts[3] === "swaps" && parts.length === 4) out = (await stub.askSwap(base, k, String(body.from || ""), String(body.to || ""))) as unknown as Out;
  else if (parts[3] === "swaps" && parts[5] === "consent") out = (await stub.consentSwap(base, k, parts[4], String(body.answer || ""))) as unknown as Out;
  else if (parts[3] === "missed" && parts[4] === "check") out = (await stub.checkMissed(base, k)) as unknown as Out;
  else if (parts[3] === "demo" && parts[4] === "skip-to-wait") out = (await stub.skipToWait(base, k)) as unknown as Out;
  else if (parts[3] === "missed" && parts[5] === "consent") out = (await stub.consentMissed(base, k, parts[4], String(body.answer || ""))) as unknown as Out;
  else if (parts[3] === "whatif" && parts.length === 4) out = (await stub.whatIf(base, k, body.change)) as unknown as Out;
  else if (parts[3] === "whatif" && parts[4] === "clear") out = (await stub.clearWhatIf(k)) as unknown as Out;
  else if (parts[3] === "splits" && parts[5] === "consent") out = (await stub.consentSplit(base, k, parts[4], String(body.answer || ""))) as unknown as Out;
  else if (parts[3] === "splits" && parts[5] === "retry") out = (await stub.retrySplit(base, k, parts[4])) as unknown as Out;
  else if (parts[3] === "rounds" && parts[5] === "release" && parts[6] === "confirm") out = (await stub.confirm(base, k, Number(parts[4]), await visitorOf(req, env))) as unknown as Out;
  else if (parts[3] === "rounds" && parts[5] === "release" && parts[6] === "retry") out = (await stub.retry(base, k, Number(parts[4]), await visitorOf(req, env))) as unknown as Out;
  else if (parts[3] === "shares" && parts[6] === "cash") out = (await stub.cash(base, k, Number(parts[4]), parts[5])) as unknown as Out;
  else if (parts[3] === "shares" && parts[6] === "card") out = (await stub.card(base, k, Number(parts[4]), parts[5], body.part)) as unknown as Out;
  else if (parts[3] === "shares" && parts[6] === "order") out = (await stub.order(base, k, Number(parts[4]), parts[5], body.part)) as unknown as Out;
  if (!out) return json({ ok: false, error: "not found" }, 404);
  return json(out.body, out.status);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/healthz") return json({ ok: true, build: env.BUILD_TAG });
    if (path === "/webhooks/paypal" && req.method === "POST") {
      const pp = new PayPal(env);
      const base = url.origin;
      const others = env.PAYPAL_PAYOUT_CLIENT_ID && env.PAYPAL_PAYOUT_WEBHOOK_ID
        ? [{ pp: payoutPayPal(env)!, webhookId: env.PAYPAL_PAYOUT_WEBHOOK_ID }]
        : [];
      return handleWebhook(req, env, ctx, pp, async (evt) => {
        const outcome = await routeEvent(
          evt,
          hubApi(env),
          (cid, e) => circleStub(env, cid).handleEvent(base, e, "SUCCESS"),
          (cid, e) => circleStub(env, cid).duplicateEvent(e),
        );
        console.log(JSON.stringify({ webhook: outcome, id: evt.id, type: evt.event_type }));
      }, others);
    }
    if (path.startsWith("/api/")) {
      try {
        return await api(req, env, ctx, url);
      } catch (e) {
        console.log(JSON.stringify({ error: String(e) }));
        return json({ ok: false, error: "Something went wrong. Try again." }, 500);
      }
    }
    if (/^\/c\/[a-z0-9]+$/.test(path)) return env.ASSETS.fetch(new Request(new URL("/circle", url), req));
    if (/^\/m\/[a-z0-9]+\/[a-z0-9]+$/.test(path)) return env.ASSETS.fetch(new Request(new URL("/member", url), req));
    if (path === "/receipt") return env.ASSETS.fetch(new Request(new URL("/receipt.html", url), req));
    return env.ASSETS.fetch(req);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const hub = hubOf(env);
    const kind = event.cron === "0 13 * * *" ? "reminders" : "reconcile";
    const ids = await hub.listCircles();
    const base = env.BUILD_TAG === "dev" ? "http://127.0.0.1:8787" : "https://circlekeeper.midknight-labs.workers.dev";
    for (const id of ids) ctx.waitUntil(circleStub(env, id).cron(base, kind));
    if (kind === "reminders") ctx.waitUntil(hub.tidy());
  },
} satisfies ExportedHandler<Env>;
