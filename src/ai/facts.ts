export type FinancialFact =
  | { kind: "share_amount"; round: number; memberId: string; name: string; cents: number }
  | { kind: "pot_amount"; round: number; cents: number }
  | { kind: "member_payment"; round: number; memberId: string; name: string; part?: number; cents?: number; paidCents?: number; status?: string; dueDate?: string }
  | { kind: "collected_total"; round: number; collectedCents: number }
  | { kind: "payout"; round: number; recipientId: string; name: string; cents: number; paidOutCents: number; status: string };
