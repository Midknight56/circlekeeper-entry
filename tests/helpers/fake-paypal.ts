// A scripted stand in for the PayPal API. Each handler gets the method, the path and the parsed body.
export interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  raw: string;
}

export type Handler = (s: Sent) => Response | Promise<Response>;

export function fakePayPal(routes: Record<string, Handler>, opts: { expiresIn?: number } = {}) {
  const sent: Sent[] = [];
  let tokens = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const raw = typeof init?.body === "string" ? init.body : "";
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const s: Sent = { method: init?.method || "GET", path: url.pathname + url.search, headers, body, raw };
    sent.push(s);
    if (url.pathname === "/v1/oauth2/token") {
      tokens++;
      return Response.json({ access_token: "tok-" + tokens, expires_in: opts.expiresIn ?? 32400 });
    }
    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, p] = pattern.split(" ");
      const re = new RegExp("^" + p.replace(/\{[^}]+\}/g, "[^/]+") + "$");
      if (m === s.method && re.test(url.pathname)) return handler(s);
    }
    return Response.json({ name: "RESOURCE_NOT_FOUND", debug_id: "dbg-404" }, { status: 404 });
  };
  return {
    fetchFn: fetchFn as typeof fetch,
    sent,
    get tokenCount() {
      return tokens;
    },
    calls: (prefix: string) => sent.filter((s) => `${s.method} ${s.path}`.startsWith(prefix)),
  };
}
