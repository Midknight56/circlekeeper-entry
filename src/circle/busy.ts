// Which circles the 5 minute check visits. Visiting every circle every 5 minutes would cost about 6 PayPal reads per
// circle per visit: 50 circles x 6 x 288 visits a day = 86,400 reads a day. Only a circle someone acted on in the
// last 2 hours, or one with a payout still being sent, needs a webhook safety net.

export const BUSY_FOR_MS = 2 * 60 * 60 * 1000;

export function shouldReconcile(now: number, lastActivity: number, payoutPending: boolean): boolean {
  return payoutPending || now - lastActivity < BUSY_FOR_MS;
}
