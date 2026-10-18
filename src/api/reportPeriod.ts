import { z } from 'zod';
import { addDays, weekStartOf } from '../lib/dates';

/**
 * The periods of the office report (owner, 2026-10-18, fbk_016). A week runs from Sunday to Saturday, and a quarter starts in
 * January, April, July or October. A start day picks the period that holds it. With no start, the period is the last full one
 * before today, so a period that is still open never shows.
 */

export const ReportPeriodKind = z.enum(['week', 'month', 'quarter', 'year']);
export type ReportPeriodKind = z.infer<typeof ReportPeriodKind>;

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
 * The days of one period. With a start, the period that holds the start day. Without one, the last full period before today:
 * the week before the week of today, the month before this one, the quarter before this one, the year before this one.
 */
export function periodRange(period: ReportPeriodKind, start: string | undefined, today: string): DayRange {
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

/**
 * The stamps that bound a day range on the Riyadh offset (+03:00, the office day of stampDay): the first instant of the first day,
 * and the first instant of the day after the last. The loader counts the events between the two, so an event counts once.
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
  completed: (projectId: string) => `report:completed:${projectId}`,
  paused: (projectId: string) => `report:paused:${projectId}`,
  review: (userId: string, verb: string) => `report:review:${userId}:${verb}`,
};
