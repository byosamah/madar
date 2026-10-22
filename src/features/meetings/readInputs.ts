import { addDays } from '../../lib/dates';

/**
 * The inputs of the two reads outside the Meetings view (fbk_022). A read and its prefetch must send the same input to fill the same
 * cache key, so both sides take it from here (the project page prefetch in `features/project/tabs.tsx`).
 */

/** The meetings of the project panel: the next 60 days, all people. */
export const PROJECT_MEETINGS_DAYS = 60;

export function projectMeetingsInput(projectId: string, today: string) {
  return { projectId, mine: false, from: today, to: addDays(today, PROJECT_MEETINGS_DAYS) };
}

/** The meetings of the Home card: my meetings of today. */
export function todayMeetingsInput(today: string) {
  return { from: today, to: today, mine: true };
}

/** The Meetings view looks 7 days back and 60 days ahead (fbk_022). */
export const MEETINGS_DAYS_BACK = 7;
export const MEETINGS_DAYS_AHEAD = 60;

/** The list of the Meetings view: my meetings, 7 days back and 60 days ahead. The screen and the press on a tab send this input. */
export function meetingsListInput(today: string) {
  return { from: addDays(today, -MEETINGS_DAYS_BACK), to: addDays(today, MEETINGS_DAYS_AHEAD), mine: true };
}
