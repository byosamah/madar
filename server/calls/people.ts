import type { User } from '../../src/api/contract/entities';
import { ApiError, forbidden, invalid, notFound } from '../../src/api/errors';
import { can } from '../../src/api/permissions';
import { nowStamp } from '../../src/lib/dates';
import { authAdminOf } from '../auth/admin';
import '../auth/effects';
import { inviteRow } from '../auth/invite';
import { hitLimit } from '../auth/rateLimit';
import { resolveActor } from '../core/actor';
import { processOutbox, writeOutbox } from '../core/effects';
import { digestOf, replay, sqlKeys, type StoredResult } from '../core/idempotency';
import { takeOfficeLock } from '../core/lock';
import type { Deps } from '../core/ports';
import { sqlFor } from '../data/dialect';
import { resolveStory, sqlStories } from '../core/story';
import type { ServerCall, ServerCallCtx } from '../core/types';

/**
 * users.invites and users.resendInvite (plan 4.11 and 5.1; task P2). Both are for the Admin and Management, as the person
 * screens are. The import of server/auth/effects registers the Auth effects of the people calls (users.create and the rest).
 *
 * users.resendInvite is a server write (C3, server/core/types.ts): runCall checks a story { id } before it, and the call does the
 * rest in its own transaction under the office lock, as a shared write does: the idempotency key replay, the story (a { ref }
 * placeholder is mapped in the batch only after the commit), the limit of 5 a day for each person, the outbox row with
 * writeOutbox, and the stored answer of the key. After the commit it runs the row with processOutbox, once and best effort;
 * the 15-minute job retries a row that failed. It changes no record, so it writes no event and sends no change signal.
 */

/** The sign-in link of each person. */
export const INVITE_LINKS_SQL = "select id, auth_user_id::text as auth from users where kind = 'human'";
/** The last invitation mail of each person: the payloads that the invitation marked as sent (server/auth/invite.ts). */
export const INVITE_SENT_SQL =
  "select payload->>'userId' as user_id, max((payload->>'sentAt')::timestamptz) as sent_at from outbox where kind in ('auth.invite', 'auth.email') and payload ? 'sentAt' group by 1";
/**
 * The SQLite forms (Supabase exit, wave 2). A person with no sign-in row has no row here, so the call says invited, as for a
 * Postgres row with a null auth_user_id. sentAt is ISO text, so the max of the texts is the newest time.
 */
export const INVITE_LINKS_LITE = 'select user_id as id, id as auth from auth_users where user_id is not null';
export const INVITE_SENT_LITE =
  "select json_extract(payload, '$.userId') as user_id, max(json_extract(payload, '$.sentAt')) as sent_at from outbox " +
  "where kind in ('auth.invite', 'auth.email') and json_type(payload, '$.sentAt') is not null group by 1";

export const RESEND_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The person whose rights the call uses: the actor, or for an agent the person it acts for. */
function authorityOf(ctx: ServerCallCtx): User {
  const actor = resolveActor(ctx.office, ctx.principal);
  return actor.kind === 'agent' ? ctx.office.lists.users[actor.ownerId!] : actor;
}

function assertManagesPeople(authority: User): void {
  if (!can(authority, 'people.manage')) throw forbidden('Only the Admin and Management manage people.', { action: 'people.manage' });
}

export const usersInvites: ServerCall<'users.invites'> = async (_input, ctx) => {
  assertManagesPeople(authorityOf(ctx));
  const { deps } = ctx;
  const people = Object.values(ctx.office.lists.users).filter((user) => user.kind === 'human').sort((a, b) => a.id.localeCompare(b.id));
  const { links, sent } = await deps.db.tx('read', async (q) => ({
    links: await q<{ id: string; auth: string | null }>(sqlFor(q, INVITE_LINKS_SQL, INVITE_LINKS_LITE)),
    sent: await q<{ user_id: string; sent_at: Date | string }>(sqlFor(q, INVITE_SENT_SQL, INVITE_SENT_LITE)),
  }));
  const linkOf = new Map(links.map((row) => [row.id, row.auth]));
  const sentOf = new Map(sent.map((row) => [row.user_id, new Date(row.sent_at)]));
  // Active: the person opened the link (Auth confirmed the email) and saved a password (PASSWORD_SET_MARK). A person who opened
  // the link and left before a password stays invited, so the Admin can send the invitation again (owner, 2026-10-04).
  const accepted = new Set((await authAdminOf(deps.authAdmin).listUsers()).filter((user) => user.confirmed && user.passwordSet).map((user) => user.authUserId));
  const output = people.map((user) => {
    const link = linkOf.get(user.id);
    const at = sentOf.get(user.id);
    return { userId: user.id, state: link && accepted.has(link) ? ('active' as const) : ('invited' as const), sentAt: at ? nowStamp(at) : null };
  });
  return { output, changed: false };
};

export function createUsersResendInvite(o: { afterCommit?: (deps: Deps, ids: string[]) => Promise<unknown> } = {}): ServerCall<'users.resendInvite'> {
  const afterCommit = o.afterCommit ?? processOutbox;
  return async (input, ctx) => {
    const authority = authorityOf(ctx);
    assertManagesPeople(authority);
    const target = ctx.office.lists.users[input.id];
    if (!target) throw notFound('Person', input.id);
    if (target.kind === 'agent') throw invalid('id', 'An agent gets no invitation. It signs in through its person.', 'invite_agent');
    if (!target.active) throw invalid('id', 'This person is no longer active.', 'person_inactive');
    if (authority.systemRole !== 'admin' && target.systemRole === 'admin') throw forbidden('Only an Admin can change an Admin or the agent of an Admin.', { action: 'people.manage' });

    const { deps } = ctx;
    const actorId = ctx.principal.userId;
    const digest = ctx.key !== undefined ? await digestOf('users.resendInvite', input) : undefined;
    const done = await deps.db.tx('write', async (q) => {
      await takeOfficeLock(q, deps.config.lockKey);
      const now = deps.clock.now();
      if (ctx.key !== undefined && digest !== undefined) {
        const stored = replay(await sqlKeys(q).get(actorId, ctx.key), digest);
        const ref = ctx.story && 'ref' in ctx.story && !ctx.batch.storyRefs.has(ctx.story.ref) ? ctx.story.ref : undefined;
        if (stored) return { result: stored, ids: [] as string[], ref };
      }
      const story = await resolveStory(sqlStories(q), ctx.story, ctx.batch.storyRefs, actorId, now);
      const limit = await hitLimit(q, { key: `invite:${target.id}`, limit: RESEND_PER_DAY, windowMs: DAY_MS, now });
      if (!limit.ok) {
        throw new ApiError('conflict', `This person got ${RESEND_PER_DAY} invitations today. Try again tomorrow.`, { reason: 'invite_limit', retryAfterMs: limit.retryAfterMs });
      }
      const ids = await writeOutbox(q, [inviteRow(target.id)]);
      const result: StoredResult = { output: { sentAt: nowStamp(now) }, storyId: story.storyId, changed: false };
      if (ctx.key !== undefined && digest !== undefined) await sqlKeys(q).put({ actorId, key: ctx.key, name: 'users.resendInvite', digest, result, at: now });
      return { result, ids, ref: story.ref };
    });

    if (done.ref !== undefined && done.result.storyId !== undefined) ctx.batch.storyRefs.set(done.ref, done.result.storyId);
    if (done.ids.length > 0) {
      try {
        await afterCommit(deps, done.ids);
      } catch (error) {
        deps.log.warn('The effects after the commit did not run. The job tries them again.', { name: 'users.resendInvite', error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { output: done.result.output as { sentAt: string }, ...(done.result.storyId !== undefined ? { storyId: done.result.storyId } : {}), changed: false };
  };
}

export const usersResendInvite: ServerCall<'users.resendInvite'> = createUsersResendInvite();
