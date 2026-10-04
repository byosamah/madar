import type { User } from '../../src/api/contract/entities';
import type { SharedCallName } from '../../src/api/sharedCalls';
import { registerEffect, registerOutbox, type OutboxProducer, type OutboxRow } from '../core/effects';
import type { Deps } from '../core/ports';
import { authAdminOf } from './admin';
import { INVITE_KIND, inviteRow, sendInvitation, sqlInviteStore, type InviteStore } from './invite';
import { renderEmailChangedMail } from './mail';

/**
 * The Auth side of the people calls (plan 5.1 and 4.12; task P2). Supabase Auth must follow the users rows: a turned-off person
 * is banned, a person turned on again is not, an email change reaches Auth, and a new person gets an invitation.
 *
 * - The producers (registerOutbox) read the call's output. users.create, users.deactivate and users.reactivate give their own
 *   row; events.undo and events.undoStory give the row of what the Undo brings back (the "after" of the undo event).
 *   users.update gives auth.email only when its save changed the email: it reads the event that the save just wrote, in the
 *   same transaction and under the office lock (USER_EMAIL_CHANGED_SQL). A name or role edit writes no row.
 * - The handlers (registerEffect) read the person again when they run. So a late retry never undoes a newer change: auth.ban
 *   does nothing when the person is on again, auth.unban nothing while the person is off.
 * - auth.email compares the email with Auth (getUser). When it changed, Auth gets the new email.
 *   A person who did not accept yet gets the email alone (Auth must not confirm a person with no password) and a new
 *   invitation at the new email; the new invite link makes the link at the old email fail at once.
 *   A person who accepted gets the email confirmed, and a notice at the OLD email (no link), so a change that the person did
 *   not expect does not go unseen.
 *   Before it changes Auth, the effect notes in the payload what it still owes (owesInvite, or notifyOld with the old email).
 *   A retry finds the email already equal, and still sends what the payload owes; sentAt and noticeSentAt stop a second mail.
 * - A person with no sign-in link (no auth_user_id yet) needs nothing: the invitation reads the email when it runs.
 * - Not handled here: agents.revokeAll after users.deactivate is track G's effect (plan 4.12); G registers its own producer.
 *   An Undo of users.create removes the person: the Auth user stays, but no users row links it, so the batch route answers 401.
 *
 * This module registers itself when it loads. server/calls/people.ts imports it, so every entry that builds the call map
 * (server/calls/index.ts) has the producers and the handlers.
 */

export const AUTH_KINDS = { invite: INVITE_KIND, ban: 'auth.ban', unban: 'auth.unban', email: 'auth.email' } as const;
export const AUTH_CALLS = ['users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'events.undo', 'events.undoStory'] as const satisfies readonly SharedCallName[];

/** Did the last user.updated event of this person change the email? runCall asks it after the save, in the same transaction. */
export const USER_EMAIL_CHANGED_SQL =
  "select (doc->'after') ? 'email' as changed from events where target_type = 'user' and target_id = $1 and verb = 'user.updated' order by ord desc limit 1";

type Rec = Record<string, unknown>;
type UserOut = { id: string; kind: string; active: boolean };
type EventOut = { targetType: string; targetId: string; before: unknown; after: unknown };

const isHuman = (user: UserOut) => user.kind === 'human';

function rowsOfEvent(event: EventOut): OutboxRow[] {
  if (event.targetType !== 'user' || event.after === null || typeof event.after !== 'object' || event.before === null) return [];
  const after = event.after as Rec;
  const rows: OutboxRow[] = [];
  if ('active' in after) rows.push({ kind: after.active === true ? AUTH_KINDS.unban : AUTH_KINDS.ban, payload: { userId: event.targetId } });
  if ('email' in after) rows.push(inviteRow(event.targetId, AUTH_KINDS.email));
  return rows;
}

/** The outbox rows of one call, from its output. */
export function authRowsOf(name: string, output: unknown): OutboxRow[] {
  switch (name) {
    case 'users.create': {
      const user = output as UserOut;
      return isHuman(user) && user.active ? [inviteRow(user.id)] : [];
    }
    case 'users.deactivate':
      return isHuman(output as UserOut) ? [{ kind: AUTH_KINDS.ban, payload: { userId: (output as UserOut).id } }] : [];
    case 'users.reactivate':
      return isHuman(output as UserOut) ? [{ kind: AUTH_KINDS.unban, payload: { userId: (output as UserOut).id } }] : [];
    case 'users.update':
      // The rows when the email changed; the producer of users.update asks the database whether it did.
      return isHuman(output as UserOut) ? [inviteRow((output as UserOut).id, AUTH_KINDS.email)] : [];
    case 'events.undo':
      return rowsOfEvent((output as { event: EventOut }).event);
    case 'events.undoStory': {
      const seen = new Set<string>();
      return (output as { undone: { event: EventOut }[] }).undone.flatMap(({ event }) => rowsOfEvent(event)).filter((row) => {
        const key = `${row.kind}|${String(row.payload.userId)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    default:
      return [];
  }
}

/**
 * users.update: the auth.email row only when the save wrote a user.updated event that changed the email. A query that is
 * refused writes the row as before (the handler then finds the email equal and does nothing): the memory data of the unit
 * tests (server/core/memoryData.ts) answers no SQL, and on Postgres a failed statement fails the whole call anyway.
 */
const emailProducer: OutboxProducer = async (output, saved, q) => {
  const rows = authRowsOf('users.update', output);
  if (rows.length === 0 || !saved.changed) return [];
  let last: { changed: boolean } | undefined;
  try {
    [last] = await q<{ changed: boolean }>(USER_EMAIL_CHANGED_SQL, [(output as UserOut).id]);
  } catch {
    return rows;
  }
  return last?.changed === true ? rows : [];
};

function userIdOf(payload: Rec): string {
  if (typeof payload.userId !== 'string' || payload.userId === '') throw new Error('The effect payload has no user id.');
  return payload.userId;
}

/** Runs one auth effect. store: the users rows (the database by default; tests pass memory). */
export async function runAuthEffect(kind: string, payload: Rec, deps: Deps, store: InviteStore = sqlInviteStore(deps)): Promise<void> {
  if (kind === AUTH_KINDS.invite) {
    await sendInvitation(payload, deps, { store });
    return;
  }
  const person = await store.person(userIdOf(payload));
  if (!person || person.authUserId === null || person.user.kind !== 'human') return;
  const { user, authUserId } = person;
  switch (kind) {
    case AUTH_KINDS.ban:
      if (!user.active) await deps.authAdmin.setBanned(authUserId, true);
      return;
    case AUTH_KINDS.unban:
      if (user.active) await deps.authAdmin.setBanned(authUserId, false);
      return;
    case AUTH_KINDS.email:
      await syncEmail(payload, deps, store, user, authUserId);
      return;
    default:
      throw new Error(`${kind} is not an auth effect.`);
  }
}

async function syncEmail(payload: Rec, deps: Deps, store: InviteStore, user: User, authUserId: string): Promise<void> {
  const admin = authAdminOf(deps.authAdmin);
  const now = await admin.getUser(authUserId);
  if (!now) return;
  const email = user.email.toLowerCase();
  const inviteId = typeof payload.inviteId === 'string' ? payload.inviteId : undefined;
  const owed: Rec = { ...payload };
  if (now.email !== email) {
    if (!inviteId) throw new Error('The auth.email payload has no invite id.');
    // Note what this row owes before Auth changes: a retry then finds the email equal and still sends it.
    const owes = now.confirmed ? { notifyOld: now.email } : { owesInvite: true };
    await store.note(inviteId, owes);
    Object.assign(owed, owes);
    await admin.updateEmail(authUserId, user.email, { confirm: now.confirmed });
  }
  if (owed.owesInvite === true && !now.confirmed) await sendInvitation(owed, deps, { store });
  if (typeof owed.notifyOld === 'string' && owed.notifyOld !== email && owed.noticeSentAt === undefined && inviteId) {
    const mail = renderEmailChangedMail(user.preferences.language, { name: user.name, email: user.email }, user.gender);
    await deps.mail.send({ to: owed.notifyOld, ...mail, tag: 'notice', idempotencyKey: `email-changed:${inviteId}` });
    await store.note(inviteId, { noticeSentAt: deps.clock.now().toISOString() });
  }
}

let registered = false;

/** Registers the producers and the handlers once. */
export function registerAuthEffects(): void {
  if (registered) return;
  registered = true;
  for (const name of AUTH_CALLS) registerOutbox(name, name === 'users.update' ? emailProducer : async (output) => authRowsOf(name, output));
  for (const kind of Object.values(AUTH_KINDS)) registerEffect(kind, (payload, deps) => runAuthEffect(kind, payload, deps));
}

registerAuthEffects();
