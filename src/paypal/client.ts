// The PayPal REST client: token cache, PayPal-Request-Id on every POST, retries, debug_id capture.

export interface PayPalEnv {
  CK: KVNamespace;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_BASE?: string;
}

export interface PayPalResult<T = any> {
  status: number;
  body: T;
  bodyRead?: boolean; // A complete JSON object was read, not a missing or malformed answer.
  hadUncertainAttempt?: boolean; // An earlier automatic send may have succeeded without a usable answer.
  debugId?: string;
  errorName?: string;
}

export interface CallRecord {
  method: string;
  path: string;
  status: number;
  debugId?: string;
  errorName?: string;
  requestId?: string;
  ids?: string[]; // ids PayPal answered with (an invoice id, a payout batch id, an order id)
}

// One token per PayPal app: Circlekeeper uses two apps (invoices on one, the pot payout on the other).
const tokenKey = (clientId: string) => `pp:token:${clientId.slice(0, 16)}`;
const EARLY_REFRESH_S = 300; // re-mint 5 minutes before PayPal's own expires_in
const MAX_TRIES = 3;

type Token = { access_token: string; exp: number };

const memoryTokens = new Map<string, Token>();

/** The error name plus PayPal's first detail (issue and field), e.g. "INVALID_REQUEST: INVALID_DATE at /detail/...". */
function errorLabel(parsed: any, status: number): string {
  const name = parsed?.name || parsed?.error || `HTTP_${status}`;
  const d = Array.isArray(parsed?.details) ? parsed.details[0] : undefined;
  return d ? `${name}: ${d.issue || ""}${d.field ? " at " + d.field : ""}`.trim() : name;
}

function answeredIds(body: any): string[] {
  const out: string[] = [];
  if (body && typeof body.id === "string") out.push(body.id);
  const batch = body?.batch_header?.payout_batch_id;
  if (typeof batch === "string") out.push(batch);
  return out;
}

export class PayPal {
  readonly base: string;
  onCall: ((rec: CallRecord) => void | Promise<void>) | null = null;
  // Asked before every write; false refuses the call without touching PayPal (the daily write caps).
  beforeWrite: ((method: string, path: string) => Promise<boolean>) | null = null;
  private mints = 0;

  constructor(
    private env: PayPalEnv,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.base = env.PAYPAL_BASE || "https://api-m.sandbox.paypal.com";
  }

  get mintCount(): number {
    return this.mints;
  }

  static resetMemory(): void {
    memoryTokens.clear();
  }

  async token(force = false): Promise<string> {
    const nowS = Math.floor(this.now() / 1000);
    const key = tokenKey(this.env.PAYPAL_CLIENT_ID);
    const memoryToken = memoryTokens.get(key);
    if (!force && memoryToken && memoryToken.exp > nowS) return memoryToken.access_token;
    if (!force) {
      const stored = await this.env.CK.get<Token>(key, "json");
      if (stored && stored.exp > nowS) {
        memoryTokens.set(key, stored);
        return stored.access_token;
      }
    }
    const basic = btoa(`${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_CLIENT_SECRET}`);
    const res = await this.fetchFn(this.base + "/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    this.mints++;
    if (!res.ok) throw new Error(`PayPal token ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    const tok: Token = { access_token: j.access_token, exp: nowS + j.expires_in - EARLY_REFRESH_S };
    memoryTokens.set(key, tok);
    await this.env.CK.put(key, JSON.stringify(tok), { expirationTtl: Math.max(60, j.expires_in - EARLY_REFRESH_S) });
    return tok.access_token;
  }

  /**
   * One REST call. `body` may be an object (sent as JSON) or a string (sent as is, for verify).
   * `requestId` should be stored by the caller and passed again on its own retries.
   */
  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts: { requestId?: string; headers?: Record<string, string> } = {},
  ): Promise<PayPalResult<T>> {
    const requestId = method === "POST" ? opts.requestId || crypto.randomUUID() : undefined;
    const isWrite = method !== "GET" && !path.startsWith("/v1/notifications/verify-webhook-signature");
    if (isWrite && this.beforeWrite && !(await this.beforeWrite(method, path))) {
      const refused: PayPalResult<T> = { status: 429, body: { name: "CK_DAILY_CAP" } as T, errorName: "CK_DAILY_CAP" };
      if (this.onCall) await this.onCall({ method, path, status: 429, errorName: "CK_DAILY_CAP", requestId });
      return refused;
    }
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    let reminted = false;
    let hadUncertainAttempt = false;
    let last: PayPalResult<T> = { status: 0, body: {} as T };
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const tok = await this.token();
      const headers: Record<string, string> = {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      };
      if (requestId) headers["PayPal-Request-Id"] = requestId;
      let res: Response;
      try {
        res = await this.fetchFn(this.base + path, { method, headers, body: payload });
      } catch {
        hadUncertainAttempt = true;
        last = { status: 0, body: {} as T, errorName: "NO_CONNECTION", bodyRead: false, hadUncertainAttempt };
        await this.sleep(500 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      let parsed: any = {};
      let bodyRead = false;
      try {
        const value = text ? JSON.parse(text) : undefined;
        bodyRead = !!value && typeof value === "object" && !Array.isArray(value);
        if (bodyRead) parsed = value;
      } catch {
        parsed = {};
      }
      last = {
        status: res.status,
        body: parsed,
        bodyRead,
        hadUncertainAttempt,
        debugId: parsed.debug_id || res.headers.get("paypal-debug-id") || undefined,
        errorName: res.ok ? undefined : errorLabel(parsed, res.status),
      };
      if (!bodyRead) hadUncertainAttempt = true;
      // 401: the token expired. 403 NOT_AUTHORIZED: the token may predate a feature being switched on for the app,
      // and a token keeps the scopes it was minted with. Either way, one fresh token and one retry.
      const staleScopes = res.status === 403 && (parsed.name === "NOT_AUTHORIZED" || parsed.error === "NOT_AUTHORIZED");
      if ((res.status === 401 || staleScopes) && !reminted) {
        reminted = true;
        memoryTokens.delete(tokenKey(this.env.PAYPAL_CLIENT_ID));
        await this.env.CK.delete(tokenKey(this.env.PAYPAL_CLIENT_ID));
        await this.token(true);
        attempt--; // the re-mint does not use up a try
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        hadUncertainAttempt = true;
        const after = Number(res.headers.get("retry-after") || "0");
        await this.sleep(after > 0 ? after * 1000 : 500 * 2 ** attempt);
        continue;
      }
      break;
    }
    if (this.onCall) {
      await this.onCall({
        method,
        path,
        status: last.status,
        debugId: last.debugId,
        errorName: last.errorName,
        requestId,
        ids: answeredIds(last.body),
      });
    }
    return last;
  }
}
