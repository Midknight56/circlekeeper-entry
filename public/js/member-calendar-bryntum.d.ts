import type { Calendar } from "@bryntum/calendar-trial";

export interface MemberCalendarRow {
  id: string | number;
  memberId: string;
  kind: "share" | "pot" | "cancelled";
  date: string;
  amount: string;
  status: string;
}

export interface MemberCalendarLabels {
  shareDue: string;
  potDay: string;
  paid: string;
}

export interface MemberCalendarEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  allDay: true;
  kind: "share" | "pot";
  paid: boolean;
  cls: string;
}

export const localeFiles: { en: "calendar.locale.En.js"; es: "calendar.locale.Es.js"; fr: "calendar.locale.FrFr.js" };
export function toBryntumEvents(rows: MemberCalendarRow[], memberId: string, lang: string, labels: MemberCalendarLabels): MemberCalendarEvent[];
export function mountBryntumCalendar(container: HTMLElement, rows: MemberCalendarRow[], memberId: string, lang: string, labels: MemberCalendarLabels, currentMonth: string | null): Promise<Calendar>;
export function updateBryntumEvents(calendar: Calendar, rows: MemberCalendarRow[], memberId: string, lang: string, labels: MemberCalendarLabels): void;
