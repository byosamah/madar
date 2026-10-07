/**
 * The shared order of tasks inside a date group of the Tasks screen and Home (owner, 2026-10-07). A task has a place number
 * (`Task.rank`): a lower number sits higher. A task with no number sits under the tasks that have one, in the default order.
 * The numbers belong to the tasks, so every person who sees two tasks in one group sees them in the same order.
 */

/** The space between two places when a list takes new numbers. */
export const RANK_STEP = 1000;
/** Below this gap a new place does not fit between two others, so the whole list takes new numbers. */
const MIN_GAP = 1e-6;

/** The places of the longest run of numbers that already go up, in list order. A task with no number is never in it. */
function longestRising(values: readonly (number | null | undefined)[]): Set<number> {
  const length: number[] = [];
  const previous: number[] = [];
  let best = -1;
  values.forEach((value, i) => {
    length[i] = 0;
    previous[i] = -1;
    if (value === null || value === undefined) return;
    length[i] = 1;
    for (let j = 0; j < i; j += 1) {
      const before = values[j];
      if (before !== null && before !== undefined && before < value && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        previous[i] = j;
      }
    }
    if (best < 0 || length[i] > length[best]) best = i;
  });
  const keep = new Set<number>();
  for (let i = best; i >= 0; i = previous[i]) keep.add(i);
  return keep;
}

/**
 * New place numbers for tasks in the order given (top first), with as few changes as possible. The tasks that already stand in
 * this order keep their number. Each other task takes a number between its neighbours. `moved` is the place of the task that the
 * person dragged: it takes the new number, so the History names the task that the person moved.
 */
export function arrangeRanks(current: readonly (number | null | undefined)[], moved?: number): number[] {
  const keep = longestRising(current.map((value, i) => (i === moved ? undefined : value)));
  const next: number[] = [];
  let i = 0;
  while (i < current.length) {
    if (keep.has(i)) {
      next[i] = current[i] as number;
      i += 1;
      continue;
    }
    let end = i;
    while (end < current.length && !keep.has(end)) end += 1;
    // The places i to end - 1 take new numbers between the kept neighbours.
    const low = i > 0 ? next[i - 1] : undefined;
    const high = end < current.length ? (current[end] as number) : undefined;
    const count = end - i;
    for (let n = 1; n <= count; n += 1) {
      next[i + n - 1] = low === undefined && high === undefined ? RANK_STEP * n
        : low === undefined ? (high as number) - RANK_STEP * (count + 1 - n)
          : high === undefined ? low + RANK_STEP * n
            : low + ((high - low) * n) / (count + 1);
    }
    i = end;
  }
  for (let n = 1; n < next.length; n += 1) {
    if (!(next[n] - next[n - 1] >= MIN_GAP)) return current.map((_, place) => RANK_STEP * (place + 1));
  }
  return next;
}

/** Rows in the shared order: the tasks with a place number first, lowest first; then the others in the order given. */
export function arranged<T extends { task: { rank?: number | null } }>(rows: readonly T[]): T[] {
  const placed = rows.filter((row) => typeof row.task.rank === 'number').sort((a, b) => (a.task.rank as number) - (b.task.rank as number));
  return [...placed, ...rows.filter((row) => typeof row.task.rank !== 'number')];
}
