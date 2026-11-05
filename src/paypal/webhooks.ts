// The PayPal webhook door: verify the signature against the raw body, then hand the event on.

import type { PayPal } from "./client";

export interface WebhookEnv {
  PAYPAL_WEBHOOK_ID: string;
}

export interface PayPalEvent {
  id: string;
  event_type: string;
  resource: any;
  create_time?: string;
}

const SIG_HEADERS = [
  ["auth_algo", "paypal-auth-algo"],
  ["cert_url", "paypal-cert-url"],
  ["transmission_id", "paypal-transmission-id"],
  ["transmission_sig", "paypal-transmission-sig"],
  ["transmission_time", "paypal-transmission-time"],
] as const;

/**
 * The verify request body as a string. The raw event text is spliced in unchanged: parsing and
 * re-serialising it would change the bytes PayPal signed.
 */
export function buildVerifyBody(headers: Headers, webhookId: string, raw: string): string | null {
  const fields: Record<string, string> = {};
  for (const [field, header] of SIG_HEADERS) {
    const v = headers.get(header);
    if (!v) return null;
    fields[field] = v;
  }
  fields.webhook_id = webhookId;
  const head = JSON.stringify(fields);
  return head.slice(0, -1) + ',"webhook_event":' + raw + "}";
}

export async function verifySignature(pp: PayPal, headers: Headers, webhookId: string, raw: string): Promise<boolean> {
  const body = buildVerifyBody(headers, webhookId, raw);
  if (!body || !webhookId) return false;
  const res = await pp.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", body);
  return res.status === 200 && res.body.verification_status === "SUCCESS";
}

/**
 * Verify, then answer 200 at once and process in the background (PayPal retries after 30 s).
 * An unverified delivery answers 400 and changes nothing.
 */
export async function handleWebhook(
  req: Request,
  env: WebhookEnv,
  ctx: ExecutionContext,
  pp: PayPal,
  process: (evt: PayPalEvent) => Promise<void>,
  others: { pp: PayPal; webhookId: string }[] = [],
): Promise<Response> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 1024 * 1024 || !raw.trim()) {
    return new Response("bad request", { status: 400 });
  }
  // Each PayPal app has its own webhook; an event is genuine if the app it came through says so.
  let ok = false;
  for (const v of [{ pp, webhookId: env.PAYPAL_WEBHOOK_ID }, ...others]) {
    if (!v.webhookId) continue;
    try {
      ok = await verifySignature(v.pp, req.headers, v.webhookId, raw);
    } catch {
      ok = false;
    }
    if (ok) break;
  }
  if (!ok) {
    console.log(JSON.stringify({ webhook: "refused", reason: "not verified" }));
    return new Response("not verified", { status: 400 });
  }
  let evt: PayPalEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  console.log(JSON.stringify({ webhook: "verified", verification_status: "SUCCESS", id: evt.id, type: evt.event_type }));
  ctx.waitUntil(process(evt));
  return new Response("ok", { status: 200 });
}
