// Payouts v1: the pot goes out. Field names proven on 22 Oct (batch HA4QPAWVJXCRU, docs/DAY1-RECEIPTS.md, C3).

import type { PayPal, PayPalResult } from "./client";

export interface NewPayout {
  senderBatchId: string;
  senderItemId: string;
  recipientEmail: string;
  cents: number;
  subject: string;
  message: string;
  note: string;
}

export async function createPayout(
  pp: PayPal,
  p: NewPayout,
  requestId: string,
): Promise<PayPalResult & { payoutBatchId?: string; batchStatus?: string }> {
  const res = await pp.request(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: { sender_batch_id: p.senderBatchId, email_subject: p.subject, email_message: p.message },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: (p.cents / 100).toFixed(2), currency: "USD" },
          receiver: p.recipientEmail,
          note: p.note,
          sender_item_id: p.senderItemId,
        },
      ],
    },
    { requestId },
  );
  const bh = res.body?.batch_header || {};
  return { ...res, payoutBatchId: bh.payout_batch_id, batchStatus: bh.batch_status };
}

export async function getPayout(
  pp: PayPal,
  batchId: string,
): Promise<PayPalResult & { batchStatus?: string; itemStatus?: string; itemId?: string; senderBatchId?: string }> {
  const res = await pp.request("GET", `/v1/payments/payouts/${batchId}`);
  const item = (res.body?.items || [])[0] || {};
  return {
    ...res,
    batchStatus: res.body?.batch_header?.batch_status,
    itemStatus: item.transaction_status,
    itemId: item.payout_item_id,
    senderBatchId: res.body?.batch_header?.sender_batch_header?.sender_batch_id,
  };
}

export function originalPayoutBatchId(res: PayPalResult): string | undefined {
  if (res.status !== 400 || res.body?.name !== "USER_BUSINESS_ERROR" || !Array.isArray(res.body?.details)) return;
  const details = res.body.details.filter((d: any) => d?.field === "SENDER_BATCH_ID");
  if (details.length === 0) return;
  const links = [...details.flatMap((d: any) => Array.isArray(d.link) ? d.link : []),
    ...(Array.isArray(res.body.links) ? res.body.links : [])];
  for (const link of links) {
    if (typeof link?.href !== "string") continue;
    try {
      const match = new URL(link.href, "https://api.paypal.com").pathname.match(/^\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)\/?$/);
      if (match) return match[1];
    } catch {}
  }
}
