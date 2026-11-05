export type NeedKind = "want" | "avoid" | "on_or_before" | "on_or_after";

export interface Need {
  memberId: string;
  kind: NeedKind;
  month: string;
  text?: string;
}

export interface Slot {
  round: number;
  memberId: string;
  month: string;
  date: string;
}

export interface SolveInput {
  memberIds: string[];
  startMonth: string;
  needs: Need[];
  payDay?: number;
}

export type SolveResult =
  | { ok: true; rotation: Slot[] }
  | { ok: false; rotation: Slot[]; broken: Need[]; reason: string };

function monthIndex(month: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Invalid month: ${month}`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export function monthOfRound(startMonth: string, round: number): string {
  const start = monthIndex(startMonth);
  if (!Number.isInteger(round) || round < 1) throw new Error("Round must be a positive integer");
  const index = start + round - 1;
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function satisfies(need: Need, round: number, start: number): boolean {
  const target = monthIndex(need.month) - start + 1;
  switch (need.kind) {
    case "want": return round === target;
    case "avoid": return round !== target;
    case "on_or_before": return round <= target;
    case "on_or_after": return round >= target;
  }
}

function hasMatching(members: string[], rounds: number[], domains: Map<string, number[]>): boolean {
  const ordered = [...members].sort((a, b) => domains.get(a)!.length - domains.get(b)!.length || members.indexOf(a) - members.indexOf(b));
  const used = new Set<number>();
  const visit = (index: number): boolean => {
    if (index === ordered.length) return true;
    const member = ordered[index]!;
    for (const round of domains.get(member)!) {
      if (!rounds.includes(round) || used.has(round)) continue;
      used.add(round);
      if (visit(index + 1)) return true;
      used.delete(round);
    }
    return false;
  };
  return visit(0);
}

function findAssignmentFromStart(memberIds: string[], needs: Need[], start: number): Map<string, number> | undefined {
  const rounds = memberIds.map((_, i) => i + 1);
  const constrained = memberIds.filter((id) => needs.some((need) => need.memberId === id));
  const domains = new Map<string, number[]>();
  for (const member of constrained) {
    domains.set(member, rounds.filter((round) => needs.filter((need) => need.memberId === member).every((need) => satisfies(need, round, start))));
  }
  const assignment = new Map<string, number>();
  const used = new Set<number>();
  const assign = (index: number): boolean => {
    if (index === constrained.length) return true;
    const member = constrained[index]!;
    for (const round of domains.get(member)!) {
      if (used.has(round)) continue;
      used.add(round);
      assignment.set(member, round);
      const remaining = constrained.slice(index + 1);
      const available = rounds.filter((candidate) => !used.has(candidate));
      if (hasMatching(remaining, available, domains) && assign(index + 1)) return true;
      assignment.delete(member);
      used.delete(round);
    }
    return false;
  };
  return assign(0) ? assignment : undefined;
}

function reasonFor(need: Need, accepted: Need[], memberIds: string[], start: number, count: number): string {
  if (!memberIds.includes(need.memberId)) return `${need.memberId} is not a member of this circle.`;
  const target = monthIndex(need.month) - start + 1;
  if (target < 1 || target > count) return `${need.memberId} needs ${need.month}, which is outside this circle.`;
  const clash = accepted.find((prior) => prior.kind === "want" && need.kind === "want" && prior.month === need.month && prior.memberId !== need.memberId);
  if (clash) return `${clash.memberId} and ${need.memberId} both need ${need.month}; only one member can take a month.`;
  return `${need.memberId}'s need for ${need.month} conflicts with an earlier need.`;
}

export function solveRotation(input: SolveInput): SolveResult {
  if (input.memberIds.length === 0) throw new Error("A circle must have at least one member");
  if (new Set(input.memberIds).size !== input.memberIds.length) throw new Error("Member ids must be unique");
  const start = monthIndex(input.startMonth);
  const count = input.memberIds.length;
  const accepted: Need[] = [];
  const broken: Need[] = [];
  let reason = "";

  for (const need of input.needs) {
    let invalid = false;
    if (!input.memberIds.includes(need.memberId)) invalid = true;
    let target = -1;
    try {
      target = monthIndex(need.month) - start + 1;
    } catch {
      invalid = true;
    }
    if (target < 1 || target > count) invalid = true;
    if (invalid || !findAssignmentFromStart(input.memberIds, [...accepted, need], start)) {
      broken.push(need);
      if (!reason) {
        try { reason = reasonFor(need, accepted, input.memberIds, start, count); }
        catch { reason = `${need.memberId} has a need for an invalid month.`; }
      }
    } else {
      accepted.push(need);
    }
  }

  const assignment = findAssignmentFromStart(input.memberIds, accepted, start)!;
  const taken = new Set(assignment.values());
  let nextFree = 0;
  for (const member of input.memberIds) {
    if (assignment.has(member)) continue;
    while (taken.has(nextFree + 1)) nextFree++;
    assignment.set(member, nextFree + 1);
    taken.add(nextFree + 1);
    nextFree++;
  }
  const payDay = Math.min(28, Math.max(1, Math.floor(input.payDay ?? 15)));
  const rotation = input.memberIds
    .map((memberId) => {
      const round = assignment.get(memberId)!;
      const month = monthOfRound(input.startMonth, round);
      return { round, memberId, month, date: `${month}-${String(payDay).padStart(2, "0")}` };
    })
    .sort((a, b) => a.round - b.round);
  return broken.length ? { ok: false, rotation, broken, reason } : { ok: true, rotation };
}
