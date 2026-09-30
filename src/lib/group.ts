/** Groups items that are already in order by a day key. A new group starts each time the day changes. */
export function groupByDay<T>(items: T[], dayOf: (item: T) => string): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayOf(item);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
