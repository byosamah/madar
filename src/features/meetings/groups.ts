import type { MeetingRow } from '../../api/contract/views';
import { addDays, dayOfWeek, stampDay, weekStartOf } from '../../lib/dates';

export type MeetingGroup = 'today' | 'week' | 'later';

/**
 * The groups of the Meetings view (fbk_022): Today, This week and Later, in this order, and the days before today apart as "Earlier",
 * the newest first. The week is the one of the Tasks screen: on a Friday or a Saturday, "This week" is the coming Sunday to
 * Saturday. A group with no meeting is left out. The rows keep the order of the call (by start).
 */
export function groupMeetings(rows: readonly MeetingRow[], today: string): { earlier: MeetingRow[]; groups: { group: MeetingGroup; rows: MeetingRow[] }[] } {
  const start = dayOfWeek(today) >= 5 ? addDays(weekStartOf(today), 7) : weekStartOf(today);
  const weekEnd = addDays(start, 6);
  const earlier: MeetingRow[] = [];
  const by: Record<MeetingGroup, MeetingRow[]> = { today: [], week: [], later: [] };
  for (const row of rows) {
    const day = stampDay(row.startsAt);
    if (day < today) earlier.push(row);
    else if (day === today) by.today.push(row);
    else if (day <= weekEnd) by.week.push(row);
    else by.later.push(row);
  }
  return {
    earlier: earlier.reverse(),
    groups: (['today', 'week', 'later'] as const).filter((group) => by[group].length > 0).map((group) => ({ group, rows: by[group] })),
  };
}
