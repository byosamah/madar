import type { TrackerDirection, TrackerEntry, TrackerType, TrackerWaiting } from '../api/contract/entities';
import type { UserCard } from '../api/contract/views';
import { addDays, diffDays, weekStartOf } from './dates';

/** An open loop: the entry waits for someone and nobody closed it. */
export function isOpen(entry: Pick<TrackerEntry, 'waiting' | 'closedAt'>): boolean {
  return entry.waiting !== null && entry.closedAt === null;
}

/** The text that says why an entry was made by itself. The "shift" value belongs to the stage and dependency work. */
export const AUTO_KEY: Partial<Record<NonNullable<TrackerEntry['auto']>, string>> = {
  upload: 'tracker.autoUpload', delivered: 'tracker.autoDelivered', version: 'tracker.autoVersion', reply: 'tracker.autoReply',
};

/** How many whole days ago the exchange was. An entry dated in the future counts as 0. */
export function ageInDays(date: string, today: string): number {
  return Math.max(0, diffDays(date, today));
}

export type WeekGroup<T> = { weekStart: string; label: 'this' | 'last' | 'date'; items: T[] };

/** Groups entries that are already newest first by office week (Sunday to Saturday). */
export function groupByWeek<T>(items: T[], dateOf: (item: T) => string, today: string): WeekGroup<T>[] {
  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const out: WeekGroup<T>[] = [];
  for (const item of items) {
    const weekStart = weekStartOf(dateOf(item));
    const last = out[out.length - 1];
    if (last?.weekStart === weekStart) {
      last.items.push(item);
      continue;
    }
    out.push({ weekStart, label: weekStart === thisWeek ? 'this' : weekStart === lastWeek ? 'last' : 'date', items: [item] });
  }
  return out;
}

/**
 * The sides an entry of this type may have, the default first. Only a message or a file goes from or to the client.
 * A meeting has two sides, a Balady update comes from a third party, and an "Other" entry may have no side at all.
 */
export function sidesOf(type: TrackerType): readonly TrackerDirection[] {
  switch (type) {
    case 'meeting': return ['both'];
    case 'balady': return ['third_party'];
    case 'other': return ['none', 'in', 'out', 'both'];
    default: return ['in', 'out'];
  }
}

/** The side that fits a new type. A message or a file keeps its side, any other type starts on its own default. */
export function sideForType(type: TrackerType, direction: TrackerDirection): TrackerDirection {
  return (type === 'message' || type === 'file') && sidesOf(type).includes(direction) ? direction : sidesOf(type)[0];
}

/** The loop an entry opens when it is marked as waiting: the office owes a reply, unless the entry goes to the client. */
export function waitingFor(direction: TrackerDirection): TrackerWaiting {
  return direction === 'out' ? 'client' : 'us';
}

/**
 * The people who can take a reply: the active project members. The API refuses an inactive person, so the list leaves them
 * out, and the default (the viewer or the first person) is always one the API takes. A member with no active flag counts as
 * active (audit 2026-10-03, V-4b).
 */
export function replyPeople(members: { user: UserCard; active?: boolean }[]): UserCard[] {
  return members.filter((member) => member.active !== false).map((member) => member.user);
}
