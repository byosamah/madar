import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockTime } from '../features/inbox/Thread';
import { addDays, clockFormat, dayOfWeek, diffDays, formatDay, formatMonth, formatMonthYear, formatNumber, formatWeekday, formatWeekdayHead, formatWeekdayLong, maxDay, minDay, now, nowStamp, officeClock, setNow, stampDay, todayISO, weekStartOf } from './dates';
import recorded from './dates.recorded.json';
import { waitingNames } from './waiting';

describe('office dates', () => {
  afterEach(() => setNow(null));

  it('pins and releases the clock', () => {
    setNow(new Date('2026-09-30T05:00:00Z'));
    expect(now().toISOString()).toBe('2026-09-30T05:00:00.000Z');
    setNow(null);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('writes stamps in office time', () => {
    expect(nowStamp(new Date('2026-09-30T05:00:00Z'))).toBe('2026-09-30T08:00:00.000+03:00');
  });

  it('uses the office day near midnight', () => {
    expect(todayISO(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    expect(todayISO(new Date('2026-09-30T20:59:00Z'))).toBe('2026-09-30');
  });

  it('does day arithmetic', () => {
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-09-30', '2026-10-12')).toBe(12);
    expect(diffDays('2026-10-12', '2026-09-30')).toBe(-12);
    expect(minDay('2026-09-30', '2026-10-01')).toBe('2026-09-30');
    expect(maxDay('2026-09-30', '2026-10-01')).toBe('2026-10-01');
  });

  it('starts weeks on Sunday', () => {
    expect(dayOfWeek('2026-09-27')).toBe(0);
    expect(weekStartOf('2026-10-01')).toBe('2026-09-27');
    expect(weekStartOf('2026-09-27')).toBe('2026-09-27');
    expect(weekStartOf('2026-10-03')).toBe('2026-09-27');
  });

  it('reads the office clock', () => {
    expect(officeClock(new Date('2026-10-01T12:30:00Z'))).toEqual({ day: '2026-10-01', weekday: 4, hour: 15 });
  });

  it('turns a stamp into its office day', () => {
    expect(stampDay('2026-09-30T23:30:00.000+03:00')).toBe('2026-09-30');
    expect(stampDay('2026-09-30T22:30:00.000Z')).toBe('2026-10-01');
  });

  // DB-3 (performance audit 2026-10-21): the day of an office stamp is its first 10 characters. It needs no Date object.
  it('gives the same day as the Date formula for every kind of stamp', () => {
    const viaDate = (stamp: string) => todayISO(new Date(stamp));
    const stamps = [
      '2026-09-30T00:00:00.000+03:00', '2026-09-30T23:59:59.999+03:00', '2026-10-01T00:00:00+03:00', '2026-12-31T23:30:00.000+03:00',
      '2026-09-30T22:30:00.000Z', '2026-09-30T21:00:00.000Z', '2026-09-30T20:59:59.999Z', '2026-09-30T10:00:00.000+00:00',
      '2026-09-30T01:00:00.000+05:00', '2026-09-30T23:00:00.000-05:00', '2026-09-30T09:00:00.000+03:30', '2028-02-29T23:30:00.000+03:00',
      '2026-09-30T09:00+03:00', '2026-09-30',
    ];
    for (const stamp of stamps) expect(stampDay(stamp), stamp).toBe(viaDate(stamp));
  });

  it('makes no Date object for a stamp in office time', () => {
    const RealDate = globalThis.Date;
    let made = 0;
    globalThis.Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        made += 1;
        super(...args);
      }
    } as DateConstructor;
    try {
      for (let i = 0; i < 50; i += 1) stampDay('2026-09-30T23:30:00.000+03:00');
    } finally {
      globalThis.Date = RealDate;
    }
    expect(made).toBe(0);
  });

  it('formats with Western digits and the Gregorian calendar', () => {
    expect(formatDay('2026-10-12', 'en')).toBe('12 Oct');
    const arabic = formatDay('2026-10-12', 'ar');
    expect(arabic).toContain('12');
    expect(arabic).not.toMatch(/[٠-٩]/);
    expect(formatNumber(48300.5, 'ar', 1)).toBe('48,300.5');
  });
});

describe('clockFormat (owner, 2026-10-21: "make the time in AM PM style not 24")', () => {
  const clock = (lang: 'en' | 'ar', stamp: string) => clockFormat(lang).format(new Date(stamp));

  it('writes an English time on the 12-hour clock, with AM and PM', () => {
    expect(clock('en', '2026-10-20T17:15:00+03:00')).toBe('5:15 PM');
    expect(clock('en', '2026-10-20T09:05:00+03:00')).toBe('9:05 AM');
    expect(clock('en', '2026-10-20T12:00:00+03:00')).toBe('12:00 PM');
    expect(clock('en', '2026-10-20T00:30:00+03:00')).toBe('12:30 AM');
    // Office time, whatever offset the stamp has.
    expect(clock('en', '2026-10-20T14:15:00Z')).toBe('5:15 PM');
  });

  it('keeps the Arabic time on the 12-hour clock, with ص and م and Western digits', () => {
    expect(clock('ar', '2026-10-20T17:15:00+03:00')).toBe('5:15 م');
    expect(clock('ar', '2026-10-20T09:05:00+03:00')).toBe('9:05 ص');
  });
});

describe('formatMonth', () => {
  it('gives the short month name with the Gregorian calendar in both languages', () => {
    expect(formatMonth('2026-10-01', 'en')).toBe('Oct');
    expect(formatMonth('2026-10-01', 'ar')).toBe('أكتوبر');
  });

  it('gives the short day labels and the names of a week and a month for the meeting timeline', () => {
    expect(formatDay('2026-09-30', 'en', 'weekdayDay')).toBe('Wed 30');
    expect(formatDay('2026-09-30', 'ar', 'weekdayDay')).toBe('الأربعاء، 30');
    expect(formatDay('2026-10-03', 'en', 'shortYear')).toBe('3 Oct 2026');
    expect(formatMonthYear('2026-10-02', 'en')).toBe('October 2026');
    expect(formatMonthYear('2026-10-02', 'ar')).toBe('أكتوبر 2026');
  });
});

describe('formatWeekdayHead', () => {
  it('keeps the short English name and gives one letter in Arabic, so seven heads fit one row', () => {
    expect(formatWeekdayHead('2026-09-27', 'en')).toBe('Sun');
    for (let i = 0; i < 7; i++) expect(formatWeekdayHead(addDays('2026-09-27', i), 'ar')).toHaveLength(1);
  });
});

describe('formatWeekday', () => {
  it('gives the short weekday name in both languages', () => {
    expect(formatWeekday('2026-09-27', 'en')).toBe('Sun');
    expect(formatWeekday('2026-09-27', 'ar')).toBe('الأحد');
  });
});

describe('formatWeekdayLong', () => {
  it('gives the long weekday name in both languages', () => {
    expect(formatWeekdayLong('2026-09-30', 'en')).toBe('Wednesday');
    expect(formatWeekdayLong('2026-09-30', 'ar')).toBe('الأربعاء');
  });
});

// Performance audit 2026-10-07, RND-1: each formatter is built once for each language and style, and every text stays the same
// character for character. dates.recorded.json holds the texts of the code before the cache.
describe('cached formatters', () => {
  const days = ['2026-01-31', '2026-02-28', '2026-12-31', '2028-02-29', '2027-01-01'];
  const styles = ['short', 'shortYear', 'long', 'weekday', 'withWeekday', 'weekdayDay'] as const;
  const stamps = ['2026-10-08T00:05:00.000+03:00', '2026-10-08T12:00:00.000+03:00', '2026-10-08T23:59:00.000+03:00', '2026-12-31T21:30:00.000Z'];
  const waitingRow = (tasks: string[], stages: string[]) =>
    ({ waitingFor: { tasks: tasks.map((title) => ({ title })), stages: stages.map((name) => ({ name })) } }) as unknown as Parameters<typeof waitingNames>[0];

  it.each(['en', 'ar'] as const)('keeps every text of the code before the cache (%s)', (lang) => {
    const texts: Record<string, string> = {};
    for (const day of days) {
      for (const style of styles) texts[`day ${day} ${style}`] = formatDay(day, lang, style);
      texts[`month ${day}`] = formatMonth(day, lang);
      texts[`monthYear ${day}`] = formatMonthYear(day, lang);
      texts[`weekday ${day}`] = formatWeekday(day, lang);
    }
    for (const [value, digits] of [[0, 0], [48300.5, 1], [1234567.891, 2], [-12.5, 0], [99.95, 1]] as const) texts[`number ${value} ${digits}`] = formatNumber(value, lang, digits);
    for (const stamp of stamps) texts[`clock ${stamp}`] = clockTime(stamp, lang);
    texts['waiting one'] = waitingNames(waitingRow(['Stair details'], []), lang);
    texts['waiting two'] = waitingNames(waitingRow(['Stair details'], ['Permits']), lang);
    texts['waiting three'] = waitingNames(waitingRow(['Stair details', 'Roof'], ['Permits']), lang);
    // Twice: a cached formatter gives the same text on the second call.
    expect(texts).toEqual(recorded[lang]);
    expect(formatDay('2026-01-31', lang, 'weekday')).toBe(recorded[lang]['day 2026-01-31 weekday']);
  });

  /** Counts the objects that a constructor of Intl builds while the test runs, on a fresh copy of the modules. */
  async function countMade<K extends 'DateTimeFormat' | 'NumberFormat' | 'ListFormat'>(kind: K, run: (modules: { dates: typeof import('./dates'); waiting: typeof import('./waiting'); thread: typeof import('../features/inbox/Thread') }) => void): Promise<number> {
    vi.resetModules();
    const modules = { dates: await import('./dates'), waiting: await import('./waiting'), thread: await import('../features/inbox/Thread') };
    const real = Intl[kind];
    let made = 0;
    const counting = new Proxy(real, { construct(target, args) { made += 1; return Reflect.construct(target, args) as object; } });
    Object.defineProperty(Intl, kind, { value: counting, configurable: true, writable: true });
    try {
      run(modules);
    } finally {
      Object.defineProperty(Intl, kind, { value: real, configurable: true, writable: true });
    }
    return made;
  }

  it('builds one day formatter for 500 calls of one language and style', async () => {
    expect(await countMade('DateTimeFormat', ({ dates }) => { for (let i = 0; i < 500; i += 1) dates.formatDay(dates.addDays('2026-10-01', i), 'ar', 'withWeekday'); })).toBe(1);
  });

  it('builds one clock formatter for 500 chat times', async () => {
    expect(await countMade('DateTimeFormat', ({ thread }) => { for (let i = 0; i < 500; i += 1) thread.clockTime(`2026-10-08T${String(i % 24).padStart(2, '0')}:05:00.000+03:00`, 'en'); })).toBe(1);
  });

  it('builds one number formatter for 500 numbers with the same digits', async () => {
    expect(await countMade('NumberFormat', ({ dates }) => { for (let i = 0; i < 500; i += 1) dates.formatNumber(i * 1.5, 'en', 1); })).toBe(1);
  });

  it('builds one list formatter for 500 waiting lines', async () => {
    expect(await countMade('ListFormat', ({ waiting }) => { for (let i = 0; i < 500; i += 1) waiting.waitingNames(waitingRow([`Task ${i}`], ['Permits']), 'ar'); })).toBe(1);
  });

  it('keeps one formatter for each language and style', async () => {
    expect(await countMade('DateTimeFormat', ({ dates }) => {
      for (const lang of ['en', 'ar'] as const) for (const style of styles) for (let i = 0; i < 20; i += 1) dates.formatDay('2026-10-08', lang, style);
    })).toBe(12);
  });
});
