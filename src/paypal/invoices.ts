// Invoicing v2. Field names proven against the sandbox on 22 Oct (docs/DAY1-RECEIPTS.md, C15 to C20).

import type { PayPal, PayPalResult } from "./client";

export interface NewInvoice {
  number: string;
  invoicerEmail: string;
  recipientEmail: string;
  recipientName: string;
  cents: number;
  dueDate: string;
  itemName: string;
  note: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export async function createInvoice(pp: PayPal, inv: NewInvoice, requestId: string): Promise<PayPalResult & { id?: string }> {
  const [given, ...rest] = inv.recipientName.split(" ");
  const res = await pp.request(
    "POST",
    "/v2/invoicing/invoices",
    {
      detail: {
        currency_code: "USD",
        invoice_number: inv.number,
        note: inv.note,
        payment_term: { due_date: inv.dueDate },
      },
      // business_name is what the payer page shows as the seller (proven on a draft, 23 Oct).
      invoicer: { email_address: inv.invoicerEmail, business_name: "Circlekeeper" },
      primary_recipients: [
        {
          billing_info: {
            email_address: inv.recipientEmail,
            name: { given_name: given || "Member", surname: rest.join(" ") || "Circle" },
          },
        },
      ],
      items: [{ name: inv.itemName, quantity: "1", unit_amount: { currency_code: "USD", value: dollars(inv.cents) } }],
    },
    { requestId, headers: { Prefer: "return=representation" } },
  );
  return { ...res, id: res.body?.id };
}

export async function sendInvoice(pp: PayPal, id: string, subject: string, note: string, requestId: string) {
  return pp.request("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, subject, note }, { requestId });
}

export async function getInvoice(pp: PayPal, id: string): Promise<PayPalResult & { invoiceStatus?: string; payerUrl?: string }> {
  const res = await pp.request("GET", `/v2/invoicing/invoices/${id}`);
  return { ...res, invoiceStatus: res.body?.status, payerUrl: res.body?.detail?.metadata?.recipient_view_url };
}

export async function remindInvoice(pp: PayPal, id: string, subject: string, note: string, requestId: string) {
  return pp.request("POST", `/v2/invoicing/invoices/${id}/remind`, { subject, note }, { requestId });
}

export async function cancelInvoice(pp: PayPal, id: string, subject: string, note: string, requestId: string) {
  return pp.request("POST", `/v2/invoicing/invoices/${id}/cancel`, { subject, note, send_to_recipient: true }, { requestId });
}

export async function recordCash(pp: PayPal, id: string, cents: number, date: string, requestId: string) {
  return pp.request(
    "POST",
    `/v2/invoicing/invoices/${id}/payments`,
    { method: "CASH", payment_date: date, amount: { currency_code: "USD", value: dollars(cents) } },
    { requestId },
  );
}

/** Finds one of our invoices by its number (POST /v2/invoicing/search-invoices answered 200 on 23 Oct). */
export async function findInvoiceByNumber(pp: PayPal, number: string): Promise<{ id?: string; status?: string }> {
  const res = await pp.request("POST", "/v2/invoicing/search-invoices?page=1&page_size=5", { invoice_number: number });
  const hit = (res.body?.items || []).find((i: any) => i?.detail?.invoice_number === number);
  return hit ? { id: hit.id, status: hit.status } : {};
}
