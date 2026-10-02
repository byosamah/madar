import { addDays, diffDays, weekStartOf } from './dates';

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

/** The middle of a day on the chart, as a percent from the start side. A one-day mark (today, a deadline) sits there. */
export function midPct(span: Span, day: string): number {
  return ((diffDays(span.start, day) + 0.5) / spanDays(span)) * 100;
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

export type Zoom = 'month' | 'quarter' | 'year';
export const ZOOMS: Zoom[] = ['month', 'quarter', 'year'];

const WINDOWS: Record<Zoom, [number, number]> = { month: [-7, 34], quarter: [-30, 61], year: [-91, 273] };

/** The office schedule window around today (plan clarification 5). Month ticks each Sunday, the others tick each month. */
export function scheduleWindow(today: string, zoom: Zoom): { span: Span; ticks: string[] } {
  const [before, after] = WINDOWS[zoom];
  const span = { start: addDays(today, before), end: addDays(today, after) };
  const ticks: string[] = [];
  if (zoom === 'month') {
    const first = weekStartOf(span.start) === span.start ? span.start : addDays(weekStartOf(span.start), 7);
    for (let day = first; day <= span.end; day = addDays(day, 7)) ticks.push(day);
  } else {
    for (const day of monthStarts({ start: `${span.start.slice(0, 7)}-01`, end: span.end })) if (day >= span.start) ticks.push(day);
  }
  return { span, ticks };
}

// Week and Month serve the weekly and the monthly meeting (owner, 2026-10-02).
export type MeetingZoom = 'week' | 'month' | 'quarter' | 'half' | 'year';
export const MEETING_ZOOMS: MeetingZoom[] = ['week', 'month', 'quarter', 'half', 'year'];

/** One press of an arrow moves the week zoom by one week, and every other zoom by one month. */
export function meetingStep(zoom: MeetingZoom): 'week' | 'month' {
  return zoom === 'week' ? 'week' : 'month';
}

/** Months before the current month, and months in all, for each meeting zoom that shows whole months. */
const MEETING_MONTHS: Record<Exclude<MeetingZoom, 'week'>, { before: number; count: number }> = {
  month: { before: 0, count: 1 },
  quarter: { before: 1, count: 3 },
  half: { before: 1, count: 6 },
  year: { before: 2, count: 12 },
};

/** The first day of the month that is n months after (or before, when n is negative) the month of the day. */
export function addMonths(day: string, n: number): string {
  const [year, month] = day.split('-').map(Number);
  const index = year * 12 + (month - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * The meeting-room window, moved by a number of steps (see meetingStep).
 * Week: Sunday to Saturday, a tick for each day. Month: the whole month, a tick for each Sunday.
 * The longer zooms: whole months around today, a tick for each month start.
 */
export function meetingWindow(today: string, zoom: MeetingZoom, shift = 0): { span: Span; ticks: string[] } {
  if (zoom === 'week') {
    const start = addDays(weekStartOf(today), shift * 7);
    return { span: { start, end: addDays(start, 6) }, ticks: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
  }
  const { before, count } = MEETING_MONTHS[zoom];
  const start = addMonths(today, shift - before);
  const end = addDays(addMonths(start, count), -1);
  if (zoom === 'month') {
    const ticks: string[] = [];
    const first = weekStartOf(start) === start ? start : addDays(weekStartOf(start), 7);
    for (let day = first; day <= end; day = addDays(day, 7)) ticks.push(day);
    return { span: { start, end }, ticks };
  }
  return { span: { start, end }, ticks: monthStarts({ start, end }) };
}

/** The part of a bar inside the window, or null when the bar is outside it. */
export function clipSpan(bar: Span, window: Span): Span | null {
  if (bar.end < window.start || bar.start > window.end) return null;
  return { start: bar.start < window.start ? window.start : bar.start, end: bar.end > window.end ? window.end : bar.end };
}

/**
 * Marks closer than `gap` (a percent of the track) share one group, so no two pressable marks overlap (WCAG 2.2
 * target size). A group starts at its earliest mark and takes every mark less than one gap after it.
 */
export function groupClose<T extends { at: number }>(items: T[], gap: number): T[][] {
  const groups: T[][] = [];
  for (const item of [...items].sort((a, b) => a.at - b.at)) {
    const last = groups[groups.length - 1];
    if (last && item.at < last[0].at + gap) last.push(item);
    else groups.push([item]);
  }
  return groups;
}
