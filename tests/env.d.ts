type CirclekeeperEnv = import("../src/worker").Env;
declare namespace Cloudflare {
  interface Env extends CirclekeeperEnv {}
}

declare module "*.js" {
  export function memberActionsFor(state: any, me: { id: string }): { split: boolean; swap: boolean; minNowCents: number; maxNowCents: number };
  export function showDraftRules(circle: { status: string; demo?: boolean }): boolean;
  export function rulesSummary(circle: {
    payDay?: number;
    brokenNeeds?: string[];
    demo?: boolean;
    rules: {
      shortShare: { allowed: boolean; minNowCents: number };
      missed: { action: "move_to_end" | "pot_waits"; graceDays: number };
      privacy: boolean;
      confirmers: string[];
    };
    members: { id: string; name: string }[];
  }): string[];
  export function monthGrid(dates: { date: string; kind: "share" | "pot"; paid: boolean; label: string }[], monthIso: string, lang: string): {
    title: string;
    weekdays: string[];
    weeks: { day: number | null; date: string | null; marks: { kind: "share" | "pot"; paid: boolean; label: string }[] }[][];
  };
  export interface ScheduleChip { kind: "share" | "pot"; memberId: string; round: number; month: string; partIndex?: number; cents: number; color: string; held?: number; label: string; }
  export interface ScheduleRow { memberId: string; name: string; chips: ScheduleChip[]; }
  export function layout(state: any): { months: string[]; rows: ScheduleRow[] };
  export class BasicScheduleView {
    constructor(container: HTMLElement);
    render(state: any): void;
    moveTurn(swap: any): void;
    markShare(share: any): void;
  }
}

interface ImportMeta {
  glob(pattern: string, options: { query?: string; import?: string; eager?: boolean }): Record<string, string>;
}

declare module "*.css?inline" { const content: string; export default content; }
declare module "*?raw" { const content: string; export default content; }
