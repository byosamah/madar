import { ApiError, invalid } from '../../src/api/errors';
import { can } from '../../src/api/permissions';
import { withRights } from '../../src/api/rights';
import type { HookQuery, ServerHooks } from '../../src/api/registry';
import type { Deps } from '../core/ports';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import { normalizeEmail } from '../enterprise/ids';

/**
 * The server hooks of the people calls (Madar enterprises, plan C). Two jobs:
 *
 * 1. The email directory (design 5.4). One email belongs to one enterprise. The preflight of users.create and of an email change reserves
 *    the email in the directory of the platform object, outside the lock and before the write. A taken email gives the calm refusal
 *    email_taken, which never names the other enterprise. The settle step makes the directory equal to the rows: it frees the reserved
 *    email when no row holds it (a write that did not commit, a replay, a row that took another email), and it frees the old email after
 *    a committed change or a removal. Every release re-reads the rows after the commit. The row of the target counts as a holder, so a
 *    write that did not change the email, and a replayed answer, never free an email that a real person holds.
 * 2. The people limit (design 5.9). The prepare step of users.create and users.reactivate counts the active humans inside the lock and
 *    refuses a person above the limit of the enterprise (Deps.enterprise). Invited people are active people and count. Turned-off, removed
 *    and agent users do not count.
 *
 * Every hook of the directory does nothing when deps.directory is undefined (the Postgres path, and a test with no directory).
 */

type Reserve = { reserved: boolean; email: string };
type Change = { reserved: string | null; release: string | null };
type Target = { kind: string | null; email: string | null };

const EMAIL_TAKEN = () => invalid('email', 'This email is already in use.', 'email_taken');

/** True when a user row of this enterprise holds the email (any state: a turned-off or removed person holds it too). */
async function emailHeld(deps: Deps, email: string, exceptId?: string): Promise<boolean> {
  const rows = await deps.db.statement(
    'read', "select 1 as n from users where lower(json_extract(doc, '$.email')) = ?1 and id is not ?2 limit 1", [email, exceptId ?? null],
  );
  return rows.length > 0;
}

/** Gives the email back to the directory unless a person of this enterprise holds it. */
async function releaseUnlessHeld(deps: Deps, email: string): Promise<void> {
  if (!deps.directory || (await emailHeld(deps, email))) return;
  await deps.directory.release(email);
}

/**
 * The person who acts, with the rights of the office attached. null when the actor is gone or cannot act. The people hooks use it to keep a
 * person without the right from probing the directory: the refusal for the right comes from the handler, so no answer of the directory
 * reaches that person.
 */
async function authorityOf(deps: Deps, actorId: string) {
  const office = await deps.db.tx('read', (q) => readLiteOffice(liteDbOf(q), q));
  const actor = office.lists.users[actorId];
  if (!actor) return null;
  const authority = actor.kind === 'agent' ? (actor.ownerId ? office.lists.users[actor.ownerId] : undefined) : actor;
  return authority ? { actor, authority: withRights(office.lists, authority) } : null;
}

/** The state of one person after the commit: the email in lower case, and whether the person is removed. */
async function rowOf(deps: Deps, id: string): Promise<{ email: string | null; removed: boolean } | undefined> {
  const [row] = await deps.db.statement<{ email: string | null; removed: number | null }>(
    'read', "select lower(json_extract(doc, '$.email')) as email, coalesce(json_extract(doc, '$.removed'), 0) as removed from users where id = ?1", [id],
  );
  return row ? { email: row.email, removed: Number(row.removed) === 1 } : undefined;
}

async function targetOf(deps: Deps, id: string): Promise<Target | undefined> {
  const [row] = await deps.db.statement<Target>('read', "select json_extract(doc, '$.kind') as kind, json_extract(doc, '$.email') as email from users where id = ?1", [id]);
  return row;
}

/** The humans who count against the people limit: active, not removed. An invited person is active, so it counts. */
export const PEOPLE_COUNT_LITE =
  "select count(*) as n from users where json_extract(doc, '$.kind') = 'human' and json_extract(doc, '$.active') = 1 and coalesce(json_extract(doc, '$.removed'), 0) = 0";

/** Refuses one more human above the limit. null is no limit. It runs inside the lock, so two creates cannot both take the last place. */
export async function assertRoomForPerson(q: HookQuery, limit: number | null): Promise<void> {
  if (limit === null) return;
  const [row] = await q<{ n: number }>(PEOPLE_COUNT_LITE);
  if (Number(row?.n ?? 0) + 1 > limit) {
    throw new ApiError('conflict', 'Your company reached its limit of people. Ask the Madar team to raise it.', { reason: 'people_limit', limit });
  }
}

/** The people limit of this object, or null: no facts (the Postgres path) and ENT_VADO with no limit both mean none. */
const peopleLimitOf = (deps: Deps): number | null => deps.enterprise?.limits().people ?? null;

export const usersCreateHooks: ServerHooks<unknown, unknown, Deps> = {
  async preflight(input, { actorId, deps }) {
    const person = input as { kind?: string; email?: string };
    if (!deps.directory || person.kind === 'agent' || typeof person.email !== 'string') return { reserved: false, email: '' } satisfies Reserve;
    const email = normalizeEmail(person.email);
    const who = await authorityOf(deps, actorId);
    // Without the right the handler refuses (forbidden). A person of this enterprise who holds the email makes the handler refuse email_taken.
    if (!who || !can(who.authority, 'people.invite') || (await emailHeld(deps, email))) return { reserved: false, email } satisfies Reserve;
    if ((await deps.directory.reserve(email)) === 'taken') throw EMAIL_TAKEN();
    return { reserved: true, email } satisfies Reserve;
  },

  async prepare(input, { deps, q }, preflight) {
    if ((input as { kind?: string }).kind !== 'agent') await assertRoomForPerson(q, peopleLimitOf(deps));
    return preflight;
  },

  async settle(_input, { deps }, preflight, outcome) {
    const reserve = preflight as Reserve | undefined;
    if (!deps.directory || !reserve?.reserved || outcome.ok) return;
    await releaseUnlessHeld(deps, reserve.email);
  },
};

export const usersUpdateHooks: ServerHooks<unknown, unknown, Deps> = {
  async preflight(input, { actorId, deps }) {
    const change = input as { id?: string; patch?: { email?: string } };
    const none: Change = { reserved: null, release: null };
    if (!deps.directory || typeof change.id !== 'string' || typeof change.patch?.email !== 'string') return none;
    const target = await targetOf(deps, change.id);
    if (!target || target.kind !== 'human' || typeof target.email !== 'string') return none;
    const email = normalizeEmail(change.patch.email);
    const old = normalizeEmail(target.email);
    if (email === old) return none;
    const who = await authorityOf(deps, actorId);
    // Only a human Admin changes an email (the handler says so); anyone else gets the handler refusal and touches no directory.
    if (!who || who.authority.systemRole !== 'admin' || who.actor.kind === 'agent' || (await emailHeld(deps, email, change.id))) return none;
    if ((await deps.directory.reserve(email)) === 'taken') throw EMAIL_TAKEN();
    return { reserved: email, release: old } satisfies Change;
  },

  async settle(_input, { deps }, preflight, outcome) {
    const change = preflight as Change | undefined;
    if (!deps.directory || !change || (change.reserved === null && change.release === null)) return;
    // The rows decide, after the commit, and the row of the target counts as a holder. The new email stays only when a row holds it: a write
    // that did not commit, a replayed answer and a row that took another email leave it with no holder, so it goes back. The old email goes
    // back only after a first answer, and only when no row holds it now: a write that left the email as it was changes nothing.
    if (change.reserved) await releaseUnlessHeld(deps, change.reserved);
    if (outcome.ok && outcome.replayed !== true && change.release) await releaseUnlessHeld(deps, change.release);
  },
};

export const usersRemoveHooks: ServerHooks<unknown, unknown, Deps> = {
  async preflight(input, { deps }) {
    const id = (input as { id?: string }).id;
    if (!deps.directory || typeof id !== 'string') return null;
    const target = await targetOf(deps, id);
    return target?.kind === 'human' && typeof target.email === 'string' ? normalizeEmail(target.email) : null;
  },

  async settle(input, { deps }, preflight, outcome) {
    const email = preflight as string | null | undefined;
    const id = (input as { id?: string }).id;
    if (!deps.directory || !email || typeof id !== 'string' || !outcome.ok || outcome.replayed === true) return;
    // A removed person frees the email in the directory (design 5.4). The record of the person stays in the enterprise, so the row of the
    // removed person is no holder here. The email goes back only when the row is removed now, still has this email, and no other row holds it.
    const row = await rowOf(deps, id);
    if (!row?.removed || row.email !== email || (await emailHeld(deps, email, id))) return;
    await deps.directory.release(email);
  },
};

/** users.reactivate of a human who is off counts one more active human. An agent, and a person who is on already, count nothing. */
export const usersReactivateHooks: ServerHooks<unknown, unknown, Deps> = {
  async prepare(input, { deps, q }) {
    const limit = peopleLimitOf(deps);
    const id = (input as { id?: string }).id;
    if (limit === null || typeof id !== 'string') return undefined;
    const [target] = await q<{ kind: string | null; active: number | null }>("select json_extract(doc, '$.kind') as kind, json_extract(doc, '$.active') as active from users where id = ?1", [id]);
    if (target?.kind === 'human' && Number(target.active) !== 1) await assertRoomForPerson(q, limit);
    return undefined;
  },
};
