import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import type { OutboxRow } from '../core/effects';
import { takeOfficeLock } from '../core/lock';
import type { AuthAdminPort, Deps } from '../core/ports';
import { setAuthUserId } from '../data/officeCache';
import { isEmailExists } from './admin';
import { renderSigninMail, signinLink } from './mail';

/**
 * The invitation (plan 5.1; effect auth.invite, plan 4.12; task P2). users.create writes the outbox row in its own transaction
 * (server/auth/effects.ts), users.resendInvite writes one for each resend (server/calls/people.ts), and the auth.email effect
 * sends one when the email of a person who did not accept yet changes. After the commit:
 *
 *   1. Read the person now. A turned-off person, an agent, or a person who is gone gets nothing.
 *   2. The link: an "invite" link of Auth. A person who already accepted gets 422 email_exists for it, so a "recovery" link
 *      goes instead (proof.md, section P1). A new invite link makes every older invite link of the person fail at once.
 *   3. In one transaction under the office lock: keep the link in the outbox payload, and write users.auth_user_id with
 *      setAuthUserId when it changed, so every warm office cache sees the sign-in link (plan 4.7).
 *   4. Send the mail in the person's language, with a link to Welcome that names the link type. The idempotency key is the
 *      invite id, so a send that runs twice goes out once.
 *   5. Mark the payload as sent (sentAt and the mail id). users.invites reads sentAt.
 *
 * A retry (the 15-minute job) reads the payload again: it keeps the token hash of the first link, so the first mail never
 * carries a dead link, and a payload that is marked as sent sends nothing more.
 */

export const INVITE_KIND = 'auth.invite';

export type SigninLink = { type: 'invite' | 'recovery'; authUserId: string; tokenHash: string };
export type Person = { user: User; authUserId: string | null };

const Payload = z.looseObject({
  userId: z.string().min(1),
  inviteId: z.string().min(1),
  tokenHash: z.string().min(1).optional(),
  authUserId: z.string().min(1).optional(),
  linkType: z.enum(['invite', 'recovery']).optional(),
  sentAt: z.string().optional(),
});

export interface InviteStore {
  person(userId: string): Promise<Person | undefined>;
  /** Keeps the link in the payload of the row with this invite id; relink: also write users.auth_user_id. One transaction. */
  keepLink(inviteId: string, userId: string, link: SigninLink, relink: boolean): Promise<void>;
  markSent(inviteId: string, at: Date, mailId: string): Promise<void>;
}

export const PERSON_SQL = 'select doc, auth_user_id::text as auth from users where id = $1';
/** The payload of the row with this invite id gains the given fields. Any kind: auth.email rows carry an invite id too. */
export const PAYLOAD_MERGE_SQL = "update outbox set payload = payload || $2::jsonb where payload->>'inviteId' = $1";

export function sqlInviteStore(deps: Pick<Deps, 'db' | 'config'>): InviteStore {
  return {
    async person(userId) {
      const [row] = await deps.db.statement<{ doc: unknown; auth: string | null }>('read', PERSON_SQL, [userId]);
      if (!row) return undefined;
      return { user: User.parse(row.doc), authUserId: row.auth };
    },
    async keepLink(inviteId, userId, link, relink) {
      await deps.db.tx('write', async (q) => {
        // The office lock orders this write with the saves of runCall, which also write users rows and office_meta.
        await takeOfficeLock(q, deps.config.lockKey);
        await q(PAYLOAD_MERGE_SQL, [inviteId, JSON.stringify({ tokenHash: link.tokenHash, authUserId: link.authUserId, linkType: link.type })]);
        if (relink) await setAuthUserId(q, userId, link.authUserId);
      });
    },
    async markSent(inviteId, at, mailId) {
      await deps.db.statement('write', PAYLOAD_MERGE_SQL, [inviteId, JSON.stringify({ sentAt: at.toISOString(), mailId })]);
    },
  };
}

/** 22 random base32 characters, as story ids use. */
export function newInviteId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let id = 'inv_';
  for (const byte of crypto.getRandomValues(new Uint8Array(22))) id += alphabet[byte & 31];
  return id;
}

/** The outbox row of one invitation (auth.invite), or of another kind that may send one (auth.email). */
export function inviteRow(userId: string, kind: string = INVITE_KIND): OutboxRow {
  return { kind, payload: { userId, inviteId: newInviteId() } };
}

/** An invite link, or a recovery link when the person already accepted (proof.md, section P1). */
export async function linkFor(admin: AuthAdminPort, email: string): Promise<SigninLink> {
  try {
    return { type: 'invite', ...(await admin.generateLink('invite', email)) };
  } catch (error) {
    if (!isEmailExists(error)) throw error;
    return { type: 'recovery', ...(await admin.generateLink('recovery', email)) };
  }
}

/**
 * Runs one invitation. "skipped": the person may not get one (turned off, an agent, gone). "already": the mail went out on an
 * earlier attempt. A failure throws, so processOutbox keeps the row for the job.
 */
export async function sendInvitation(
  raw: Record<string, unknown>, deps: Deps, o: { store?: InviteStore } = {},
): Promise<'sent' | 'skipped' | 'already'> {
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) throw new Error('The invitation payload has no user id or invite id.');
  const payload = parsed.data;
  const store = o.store ?? sqlInviteStore(deps);
  if (payload.sentAt) return 'already';
  const person = await store.person(payload.userId);
  if (!person || person.user.kind !== 'human' || !person.user.active) {
    deps.log.info('An invitation was not sent: the person is turned off, an agent, or gone.', { userId: payload.userId });
    return 'skipped';
  }
  let link: SigninLink;
  if (payload.tokenHash && payload.authUserId && payload.linkType) {
    link = { type: payload.linkType, authUserId: payload.authUserId, tokenHash: payload.tokenHash };
  } else {
    link = await linkFor(deps.authAdmin, person.user.email);
    await store.keepLink(payload.inviteId, payload.userId, link, link.authUserId !== person.authUserId);
  }
  const { user } = person;
  const mail = renderSigninMail('invite', user.preferences.language, {
    name: user.name, link: signinLink(deps.config.appUrl, 'welcome', link.tokenHash, link.type),
  }, user.gender);
  const sent = await deps.mail.send({ to: user.email, ...mail, tag: 'invite', idempotencyKey: `invite:${payload.inviteId}` });
  await store.markSent(payload.inviteId, deps.clock.now(), sent.id);
  return 'sent';
}
