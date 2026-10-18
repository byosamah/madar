/**
 * The pure math of the template timeline. A chart counts whole working days from day 0. The caller measures a pixel from the
 * start side of the chart, so the same math serves Arabic, where the start side is on the right.
 */

/** Working days in one week: Sunday to Thursday. */
export const WEEK = 5;

/** The working day under a pixel. The result is a whole day, and it never falls outside the chart. */
export function dayAt(x: number, width: number, days: number): number {
  if (width <= 0 || days <= 0) return 0;
  const day = Math.floor(x / (width / days));
  return Math.min(days - 1, Math.max(0, day));
}

/**
 * The left edge and the width of a bar, in percent of the chart. The start and the length are whole working days. A bar that
 * reaches past the end of the chart is cut at the end, and a bar is always at least one day long.
 */
export function barOf(start: number, length: number, days: number): { left: number; width: number } {
  if (days <= 0) return { left: 0, width: 0 };
  const from = Math.min(days - 1, Math.max(0, Math.round(start)));
  const span = Math.min(days - from, Math.max(1, Math.round(length)));
  return { left: (from / days) * 100, width: (span / days) * 100 };
}

/** The working days that a chart shows: whole weeks that cover the last end, one spare week, and at least two weeks. */
export function chartDays(lastEnd: number): number {
  return Math.max(2 * WEEK, (Math.ceil(Math.max(0, lastEnd) / WEEK) + 1) * WEEK);
}

/** The first working day of each week after day 0, for the week marks of a chart. */
export function weekStarts(days: number): number[] {
  const marks: number[] = [];
  for (let day = WEEK; day < days; day += WEEK) marks.push(day);
  return marks;
}

/**
 * True when the part `from` waits for the part `to`, through any chain of waits. "edges" maps a part to the parts it waits for.
 * A new link "to waits for from" then closes a loop, because `to` would wait for itself through `from`.
 */
export function waitsThrough(edges: ReadonlyMap<string, readonly string[]>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
  return false;
}
