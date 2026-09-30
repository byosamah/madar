import { addDays, diffDays } from './dates';

/** A run of days, both ends included. */
export type Span = { start: string; end: string };

export function nextMonthStart(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The chart range: whole months around every date, so the scale starts and ends on a month edge. */
export function chartRange(days: (string | null)[]): Span | null {
  const valid = days.filter((day): day is string => Boolean(day)).sort();
  if (valid.length === 0) return null;
  return { start: `${valid[0].slice(0, 7)}-01`, end: addDays(nextMonthStart(valid[valid.length - 1]), -1) };
}

export function spanDays(span: Span): number {
  return diffDays(span.start, span.end) + 1;
}

/** Where a day starts on the chart, as a percent from the start side. */
export function offsetPct(span: Span, day: string): number {
  return (diffDays(span.start, day) / spanDays(span)) * 100;
}

/** The width of a bar from its first day to its last day, as a percent. */
export function widthPct(span: Span, start: string, end: string): number {
  return ((diffDays(start, end) + 1) / spanDays(span)) * 100;
}

/** The first day of each month in the range, for the scale labels. */
export function monthStarts(span: Span): string[] {
  const out: string[] = [];
  for (let day = span.start; day <= span.end; day = nextMonthStart(day)) out.push(day);
  return out;
}

/** Whole days for a drag of dx pixels. Time runs toward the end side, so in Arabic a drag to the left moves dates later. */
export function dayDelta(dxPx: number, widthPx: number, totalDays: number, rtl: boolean): number {
  if (widthPx <= 0) return 0;
  const days = Math.round((dxPx / widthPx) * totalDays);
  return (rtl ? -days : days) || 0;
}

/** Moves one edge of a stage and keeps the start on or before the end. */
export function moveEdge(stage: Span, edge: 'start' | 'end', days: number): Span {
  if (edge === 'start') {
    const start = addDays(stage.start, days);
    return { start: start > stage.end ? stage.end : start, end: stage.end };
  }
  const end = addDays(stage.end, days);
  return { start: stage.start, end: end < stage.start ? stage.start : end };
}
