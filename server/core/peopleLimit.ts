import { ApiError } from '../../src/api/errors';
import type { HookQuery } from '../../src/api/registry';
import type { State } from '../../src/api/store';

/**
 * The people limit of an enterprise (Madar enterprises, design 5.9). Active humans count, and an invited person is active. Turned-off,
 * removed and agent users do not count. The count lives here, in core, because runCall checks it for every write call (the Undo of a
 * turn-off or of a remove turns people on again), and the early hooks of users.create and users.reactivate use the same text.
 */

/** The humans who count against the people limit: active, not removed. An invited person is active, so it counts. */
export const PEOPLE_COUNT_LITE =
  "select count(*) as n from users where json_extract(doc, '$.kind') = 'human' and json_extract(doc, '$.active') = 1 and coalesce(json_extract(doc, '$.removed'), 0) = 0";

/** The one refusal of the limit, with the same text and reason in the hook and in the central check. */
export const peopleLimitError = (limit: number): ApiError =>
  new ApiError('conflict', 'Your company reached its limit of people. Ask the Madar team to raise it.', { reason: 'people_limit', limit });

/** Refuses one more human above the limit. null is no limit. It runs inside the lock, so two creates cannot both take the last place. */
export async function assertRoomForPerson(q: HookQuery, limit: number | null): Promise<void> {
  if (limit === null) return;
  const [row] = await q<{ n: number }>(PEOPLE_COUNT_LITE);
  if (Number(row?.n ?? 0) + 1 > limit) throw peopleLimitError(limit);
}

type Person = { kind?: string; active?: boolean; removed?: boolean } | undefined;
const counts = (user: Person): number => (user?.kind === 'human' && user.active === true && user.removed !== true ? 1 : 0);

/**
 * How many more people count after a call than before it, from the users that the call loaded. A call loads the users that it reads, so
 * only a user in both states, or in one of them, adds to the sum. A negative number means fewer people.
 */
export function peopleAdded(before: Pick<State, 'users'>, after: Pick<State, 'users'>): number {
  let added = 0;
  for (const id of new Set([...Object.keys(before.users), ...Object.keys(after.users)])) added += counts(after.users[id]) - counts(before.users[id]);
  return added;
}

/**
 * The central check of runCall, after the save and inside the lock: when a call turned more people on than it turned off, and the
 * count of the rows is above the limit, the call fails and the transaction rolls back. A call that adds nobody never fails here, also
 * when the office is above a limit that was lowered. null is no limit (the Postgres path has no facts, and ENT_VADO may have none).
 */
export async function assertPeopleWithinLimit(q: HookQuery, limit: number | null, before: Pick<State, 'users'>, after: Pick<State, 'users'>): Promise<void> {
  if (limit === null || peopleAdded(before, after) <= 0) return;
  const [row] = await q<{ n: number }>(PEOPLE_COUNT_LITE);
  if (Number(row?.n ?? 0) > limit) throw peopleLimitError(limit);
}
