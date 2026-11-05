// Orders v2: the fallback way to pay a share. Proven on 22 Oct (order 1ML49459NX1207543, rel payer-action, C4).

import type { PayPal, PayPalResult } from "./client";

export async function createOrder(
  pp: PayPal,
  o: { cents: number; customId: string; returnUrl: string; cancelUrl: string },
  requestId: string,
): Promise<PayPalResult & { id?: string; approveUrl?: string }> {
  return sendOrder(pp, orderRequestBody(o), requestId);
}

/** Serialize once before sending, so a later replay uses the exact original payload. */
export function orderRequestBody(o: { cents: number; customId: string; returnUrl: string; cancelUrl: string }): string {
  return JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: (o.cents / 100).toFixed(2) }, custom_id: o.customId }],
    payment_source: {
      paypal: { experience_context: { return_url: o.returnUrl, cancel_url: o.cancelUrl, user_action: "PAY_NOW" } },
    },
  });
}

export async function captureOrder(pp: PayPal, id: string, requestId: string) {
  const res = await pp.request("POST", `/v2/checkout/orders/${id}/capture`, {}, { requestId });
  const cap = res.body?.purchase_units?.[0]?.payments?.captures?.[0];
  return { ...res, orderStatus: res.body?.status as string | undefined, captureId: cap?.id as string | undefined };
}

export async function getOrder(pp: PayPal, id: string) {
  const res = await pp.request("GET", `/v2/checkout/orders/${id}`);
  return { ...res, orderStatus: res.body?.status as string | undefined };
}

// PayPal's published sandbox test Visa (docs/paypal-apps/reference/webhook-sandbox.md, "Path A"). The sandbox accepts
// only test cards; this is never sent anywhere but api-m.sandbox.paypal.com (payShareByTestCard checks the base URL).
const SANDBOX_TEST_CARD = { number: "4111111111111111", expiry: "2030-12", name: "Circle Member", security_code: "123" };

/** A sandbox order paid at once with the test card: real sandbox money reaches the merchant, no sign in needed. */
export async function createTestCardOrder(pp: PayPal, o: { cents: number; customId: string }, requestId: string) {
  return sendOrder(pp, testCardOrderRequestBody(o), requestId);
}

export function testCardOrderRequestBody(o: { cents: number; customId: string }): string {
  return JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: (o.cents / 100).toFixed(2) }, custom_id: o.customId }],
    payment_source: { card: SANDBOX_TEST_CARD },
  });
}

export async function sendOrder(pp: PayPal, body: string, requestId: string) {
  let res: PayPalResult;
  try {
    res = await pp.request("POST", "/v2/checkout/orders", body, { requestId });
  } catch {
    // Includes a response stream that failed while being read. It cannot prove no order was made.
    res = { status: 0, body: {}, errorName: "NO_CONNECTION", bodyRead: false, hadUncertainAttempt: true };
  }
  const links: { rel: string; href: string }[] = Array.isArray(res.body?.links) ? res.body.links : [];
  const cap = res.body?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    ...res, id: res.body?.id as string | undefined,
    approveUrl: links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
    orderStatus: res.body?.status as string | undefined, captureId: cap?.id as string | undefined,
  };
}
