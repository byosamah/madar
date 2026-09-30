// Office time helpers. The office runs on Arabia Standard Time (UTC+3, no daylight saving).
export const OFFICE_TZ = 'Asia/Riyadh';
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let fixedNow: Date | null = null;

/** Tests and the prototype can pin "now". Pass null to use the real clock. */
export function setNow(value: Date | null): void {
  fixedNow = value ? new Date(value.getTime()) : null;
}

export function now(): Date {
  return fixedNow ? new Date(fixedNow.getTime()) : new Date();
}

/** An ISO timestamp in office time, for example 2026-09-30T08:00:00.000+03:00. */
export function nowStamp(at: Date = now()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().replace('Z', '+03:00');
}

/** The office calendar day (YYYY-MM-DD) for a moment. */
export function todayISO(at: Date = now()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

function toMs(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromMs(toMs(day) + n * DAY_MS);
}

/** The number of days from "from" to "to". Negative when "to" is earlier. */
export function diffDays(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

export function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

/** 0 is Sunday, 6 is Saturday. */
export function dayOfWeek(day: string): number {
  return new Date(toMs(day)).getUTCDay();
}

/** The office week starts on Sunday. */
export function weekStartOf(day: string): string {
  return addDays(day, -dayOfWeek(day));
}

export function officeClock(at: Date = now()): { day: string; weekday: number; hour: number } {
  const shifted = new Date(at.getTime() + OFFSET_MS);
  return { day: shifted.toISOString().slice(0, 10), weekday: shifted.getUTCDay(), hour: shifted.getUTCHours() };
}

export function stampDay(stamp: string): string {
  return todayISO(new Date(stamp));
}

export type Lang = 'en' | 'ar';

const LOCALES: Record<Lang, string> = {
  en: 'en-GB-u-ca-gregory-nu-latn',
  ar: 'ar-SA-u-ca-gregory-nu-latn',
};

export function localeFor(lang: Lang): string {
  return LOCALES[lang];
}

export function formatDay(day: string, lang: Lang, style: 'short' | 'long' = 'short'): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(LOCALES[lang], options).format(new Date(toMs(day)));
}

/** The short month name, for the month scale of a schedule. */
export function formatMonth(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { month: 'short', timeZone: 'UTC' }).format(new Date(toMs(day)));
}

/** The short weekday name, for the timesheet columns. */
export function formatWeekday(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short', timeZone: 'UTC' }).format(new Date(toMs(day)));
}

export function formatNumber(value: number, lang: Lang, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: fractionDigits }).format(value);
}
