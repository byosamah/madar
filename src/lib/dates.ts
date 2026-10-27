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

// A stamp in office time, as nowStamp writes it. Its office day is its first 10 characters (DB-3, 2026-10-21).
const OFFICE_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\+03:00$/;

/** The office calendar day of a stamp. A stamp in office time needs no Date object: a report reads thousands of them. */
export function stampDay(stamp: string): string {
  return OFFICE_STAMP.test(stamp) ? stamp.slice(0, 10) : todayISO(new Date(stamp));
}

export type Lang = 'en' | 'ar';

const LOCALES: Record<Lang, string> = {
  en: 'en-GB-u-ca-gregory-nu-latn',
  ar: 'ar-SA-u-ca-gregory-nu-latn',
};

export function localeFor(lang: Lang): string {
  return LOCALES[lang];
}

export type DayStyle = 'short' | 'shortYear' | 'long' | 'weekday' | 'withWeekday' | 'weekdayDay';

const DAY_OPTIONS: Record<DayStyle, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short', timeZone: 'UTC' },
  shortYear: { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
  weekdayDay: { weekday: 'short', day: 'numeric', timeZone: 'UTC' },
  withWeekday: { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' },
  weekday: { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' },
  long: { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
};

/**
 * One formatter for each language and style, built on its first use (performance audit 2026-10-07, RND-1). A new Intl object
 * costs about 50 microseconds and a reused one about 0.5, and a formatter keeps no state between calls, so every text stays the
 * same. The cache holds at most a few dozen small objects.
 */
const formats = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.ListFormat>();

function once<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.ListFormat>(key: string, make: () => T): T {
  let format = formats.get(key) as T | undefined;
  if (!format) {
    format = make();
    formats.set(key, format);
  }
  return format;
}

const dayFormat = (lang: Lang, style: DayStyle) => once(`day|${lang}|${style}`, () => new Intl.DateTimeFormat(LOCALES[lang], DAY_OPTIONS[style]));
const monthFormat = (lang: Lang) => once(`month|${lang}`, () => new Intl.DateTimeFormat(LOCALES[lang], { month: 'short', timeZone: 'UTC' }));
const monthYearFormat = (lang: Lang) => once(`monthYear|${lang}`, () => new Intl.DateTimeFormat(LOCALES[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }));
const weekdayFormat = (lang: Lang) => once(`weekday|${lang}`, () => new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short', timeZone: 'UTC' }));
const weekdayLongFormat = (lang: Lang) => once(`weekdayLong|${lang}`, () => new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', timeZone: 'UTC' }));
const weekdayHeadFormat = (lang: Lang) => once(`weekdayHead|${lang}`, () => new Intl.DateTimeFormat(LOCALES[lang], { weekday: lang === 'ar' ? 'narrow' : 'short', timeZone: 'UTC' }));
const numberFormat = (lang: Lang, fractionDigits: number) => once(`number|${lang}|${fractionDigits}`, () => new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: fractionDigits }));

/** The list of names in the interface language: "A, B and C". */
export const listFormat = (lang: Lang) => once(`list|${lang}`, () => new Intl.ListFormat(LOCALES[lang], { type: 'conjunction' }));

/**
 * The office clock time of a moment, on the 12-hour clock in both languages (owner, 2026-10-21): "5:15 PM" and «5:15 م». English takes
 * the US form, so AM and PM come in capitals; the other English texts keep the British forms of LOCALES.
 */
const CLOCK_LOCALES: Record<Lang, string> = { en: 'en-US-u-ca-gregory-nu-latn', ar: LOCALES.ar };
export const clockFormat = (lang: Lang) => once(`clock|${lang}`, () => new Intl.DateTimeFormat(CLOCK_LOCALES[lang], { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: OFFICE_TZ }));

export function formatDay(day: string, lang: Lang, style: DayStyle = 'short'): string {
  return dayFormat(lang, style).format(new Date(toMs(day)));
}

/** The short month name, for the month scale of a schedule. */
export function formatMonth(day: string, lang: Lang): string {
  return monthFormat(lang).format(new Date(toMs(day)));
}

/** The month and the year, "October 2026", for the name of a month on a schedule. */
export function formatMonthYear(day: string, lang: Lang): string {
  return monthYearFormat(lang).format(new Date(toMs(day)));
}

/** The short weekday name, for the timesheet columns. */
export function formatWeekday(day: string, lang: Lang): string {
  return weekdayFormat(lang).format(new Date(toMs(day)));
}

/** The long weekday name, for a label that a screen reader reads and for a sentence ("Sunday"). */
export function formatWeekdayLong(day: string, lang: Lang): string {
  return weekdayLongFormat(lang).format(new Date(toMs(day)));
}

/** The weekday name for the head of a calendar column: short in English, one letter in Arabic (the long Arabic names touch). */
export function formatWeekdayHead(day: string, lang: Lang): string {
  return weekdayHeadFormat(lang).format(new Date(toMs(day)));
}

export function formatNumber(value: number, lang: Lang, fractionDigits = 0): string {
  return numberFormat(lang, fractionDigits).format(value);
}
