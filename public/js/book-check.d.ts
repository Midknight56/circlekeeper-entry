export function checkBook(receipts: Array<{
  round: number;
  previousHash?: string;
  hash?: string;
  lines: unknown[];
}>): Promise<{ ok: true } | { ok: false; round: number }>;
