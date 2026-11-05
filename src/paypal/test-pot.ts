export type LocalTestPot = { clientId: string; clientSecret: string; sendCents: number } | { refuse: true };

export function localTestPot(env: { DEV_ROUTES?: string; LOCAL_POT_CLIENT_ID?: string; LOCAL_POT_CLIENT_SECRET?: string; LOCAL_POT_SEND_CENTS?: string }): LocalTestPot | undefined {
  if (env.DEV_ROUTES !== "1") return undefined;
  if (!env.LOCAL_POT_CLIENT_ID || !env.LOCAL_POT_CLIENT_SECRET) return { refuse: true };
  return { clientId: env.LOCAL_POT_CLIENT_ID, clientSecret: env.LOCAL_POT_CLIENT_SECRET, sendCents: Number(env.LOCAL_POT_SEND_CENTS) || 100 };
}
