export type ReceiptSource = {
  round: number;
  payoutBatchId: string | null;
  itemStatus: string | null;
  paidOutCents: number;
  lines: { memberId: string; parts: { invoiceId: string; cents: number; paid: boolean; method: string }[] }[];
};

export type ReceiptLine =
  | { kind: "share"; memberId: string; part: number; invoiceId: string; cents: number; method: string; paid: boolean }
  | { kind: "pot"; payoutBatchId: string | null; itemStatus: string | null; cents: number }
  | { kind: "delta"; moneyInCents: number; moneyOutCents: number; cents: number; reason: string | null };

export type Receipt = { round: number; lines: ReceiptLine[]; moneyInCents: number; moneyOutCents: number; deltaCents: number; deltaReason: string | null; previousHash?: string; hash?: string };

export function buildReceipt(source: ReceiptSource): Receipt {
  const lines: ReceiptLine[] = [];
  let moneyInCents = 0;
  for (const share of [...source.lines].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))) {
    share.parts.forEach((part, index) => {
      lines.push({ kind: "share", memberId: share.memberId, part: index + 1, invoiceId: part.invoiceId, cents: part.cents, method: part.method, paid: part.paid });
      if (part.paid) moneyInCents += part.cents;
    });
  }
  const moneyOutCents = source.paidOutCents;
  const deltaCents = moneyInCents - moneyOutCents;
  const reason = deltaCents === 0 ? null : "Money in and money out do not match.";
  lines.push({ kind: "pot", payoutBatchId: source.payoutBatchId, itemStatus: source.itemStatus, cents: moneyOutCents });
  lines.push({ kind: "delta", moneyInCents, moneyOutCents, cents: deltaCents, reason });
  return { round: source.round, lines, moneyInCents, moneyOutCents, deltaCents, deltaReason: reason };
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hashes canonical JSON in round order, chaining each receipt to the prior hash. */
export async function hashReceiptChain(receipts: Receipt[]): Promise<Receipt[]> {
  let previousHash = "";
  const result: Receipt[] = [];
  for (const receipt of [...receipts].sort((a, b) => a.round - b.round)) {
    const payload = { round: receipt.round, previousHash, lines: receipt.lines };
    const hash = await sha256(JSON.stringify(payload));
    result.push({ ...receipt, previousHash, hash });
    previousHash = hash;
  }
  return result;
}
