import { z } from 'zod';
import { addDays, weekStartOf } from '../lib/dates';

/**
 * The periods of the office report (owner, 2026-10-18, fbk_016). A week runs from Sunday to Saturday, and a quarter starts in
 * January, April, July or October. A start day picks the period that holds it. With no start, the period is the last full one
 * before today, so a period that is still open never shows. A range (owner, 2026-10-21) is any first and last day, for "a Madar
 * report from 1 to 15 October".
 */

export const ReportPeriodKind = z.enum(['week', 'month', 'quarter', 'year', 'range']);
export type ReportPeriodKind = z.infer<typeof ReportPeriodKind>;
/** The named periods: every kind but the range, which takes its own two days. */
export type NamedPeriodKind = Exclude<ReportPeriodKind, 'range'>;

/** The longest range, in days, both ends included (owner, 2026-10-21). A year has 366 days at most. */
export const REPORT_RANGE_MAX_DAYS = 400;

/** The number of weeks of the trend of the to-dos (owner, 2026-10-21): the one chart of the Madar report. */
export const TREND_WEEKS = 6;

/** The first and the last day of a period, both inclusive, in the office days (Riyadh). */
export type DayRange = { from: string; to: string };

const pad = (n: number): string => String(n).padStart(2, '0');

/** The last day of a month. The month is 1 to 12. */
function lastDayOf(year: number, month: number): string {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(days)}`;
}

function monthRange(year: number, month: number): DayRange {
  return { from: `${year}-${pad(month)}-01`, to: lastDayOf(year, month) };
}

/** The quarter q (0 to 3) of a year: the first month is January, April, July or October. */
function quarterRange(year: number, quarter: number): DayRange {
  return { from: `${year}-${pad(quarter * 3 + 1)}-01`, to: lastDayOf(year, quarter * 3 + 3) };
}

function yearRange(year: number): DayRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * The days of one period. With a start, the period that holds the start day. Without one, the last full period before today.
 * It is the week before the week of today, the month before this one, the quarter before this one, or the year before this one.
 */
export function periodRange(period: NamedPeriodKind, start: string | undefined, today: string): DayRange {
  if (period === 'week') {
    const first = start !== undefined ? weekStartOf(start) : addDays(weekStartOf(today), -7);
    return { from: first, to: addDays(first, 6) };
  }
  const anchor = start ?? today;
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  if (period === 'month') {
    if (start !== undefined) return monthRange(year, month);
    return month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1);
  }
  if (period === 'quarter') {
    const quarter = Math.floor((month - 1) / 3);
    if (start !== undefined) return quarterRange(year, quarter);
    return quarter === 0 ? quarterRange(year - 1, 3) : quarterRange(year, quarter - 1);
  }
  return start !== undefined ? yearRange(year) : yearRange(year - 1);
}

/** What picks the days of a report: a named period with an optional start, or a range with its two days. */
export type ReportPick = { period: ReportPeriodKind; start?: string; from?: string; to?: string };

/**
 * The days of a report. A range keeps its two days, which the input schema of reports.office checked. A named period gives the
 * days of periodRange.
 */
export function reportRange(pick: ReportPick, today: string): DayRange {
  if (pick.period !== 'range') return periodRange(pick.period, pick.start, today);
  if (pick.from === undefined || pick.to === undefined) throw new Error('A range report needs from and to.');
  return { from: pick.from, to: pick.to };
}

/** The weeks of the trend, Sunday to Saturday, oldest first: TREND_WEEKS weeks up to and with the week that holds the day. */
export function trendWeeks(day: string, count: number = TREND_WEEKS): DayRange[] {
  const last = weekStartOf(day);
  return Array.from({ length: count }, (_, i) => {
    const from = addDays(last, -7 * (count - 1 - i));
    return { from, to: addDays(from, 6) };
  });
}

/**
 * The stamps that bound a day range on the Riyadh offset (+03:00, the office day of stampDay). The first stamp is the first instant
 * of the first day. The second stamp is the first instant of the day after the last day. The loader counts the events between the
 * two, so an event counts once.
 */
export function periodStamps(range: DayRange): { from: string; until: string } {
  return { from: `${range.from}T00:00:00+03:00`, until: `${addDays(range.to, 1)}T00:00:00+03:00` };
}

/**
 * The event keys of the report counts (State.counts). The loader writes them with countWhere, and the handler reads them. Each key
 * names one count, so a second read of the same count cannot collide with it.
 */
export const REPORT_STAGE_VERB = 'project.stage_changed';
export const REPORT_COMPLETED_VERB = 'project.status_changed';
export const REPORT_PAUSED_VERB = 'project.paused';
/** A review ends with an approval or with a send back. Both count as a review done. */
export const REPORT_REVIEW_VERBS = ['task.approved', 'task.sent_back'] as const;

export const REPORT_KEYS = {
  stageMoves: 'report:stageMoves',
  /** The stage moves of one project: counted only when the report names a sub-company (INT-09). */
  stageMovesOf: (projectId: string) => `report:stageMoves:${projectId}`,
  completed: (projectId: string) => `report:completed:${projectId}`,
  paused: (projectId: string) => `report:paused:${projectId}`,
};
