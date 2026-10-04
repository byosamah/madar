import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import type { OutboxRow } from '../core/effects';
import { takeOfficeLock } from '../core/lock';
import type { AuthAdminPort, Deps } from '../core/ports';
import { setAuthUserId } from '../data/officeCache';
import { QuotaFull, reserve, sendCounted } from '../mail/quota';
import { isEmailExists } from './admin';
import { renderSigninMail, signinLink } from './mail';
import { hashedKey } from './rateLimit';

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
 *   4. Read the person again. A person turned off meanwhile (users.deactivate committed after step 1) gets no mail, and the
 *      Auth user of the new link is banned here, because the auth.ban effect of that call found no sign-in link yet.
 *   5. Send the mail in the person's language, with a link to Welcome that names the link type. The idempotency key is the
 *      invite id, so a send that runs twice goes out once. An invite link also carries a renew key (security fix 7, below).
 *   6. Mark the payload as sent (sentAt and the mail id) and drop the token hash and the renew key: done rows stay in the
 *      outbox, and both are live credentials. users.invites reads sentAt.
 *
 * A retry (the 15-minute job) reads the payload again: it keeps the token hash of the first link, so the first mail never
 * carries a dead link, and a payload that is marked as sent sends nothing more. A stored link is dead when a later row of the
 * same person made a newer link (a new invite link makes the older ones fail): that retry sends nothing.
 *
 * The renew key (security fix 7): an Auth link lives 1 hour (otp_expiry), so an invitation that the person opens the next day
 * is out of date. The Welcome link of an invite link carries `renew`, an opaque random key (52 base32 characters, newRenewKey)
 * that names no person and no email. With it the Welcome screen asks POST /auth/renew-invite (server/auth/renew.ts) for a new
 * invitation to the same person. The payload keeps the key next to the token hash until the mail is sent, so a retry sends the
 * same mail and Resend answers it with the first mail (a lost answer of the mail sender). After the send the payload keeps
 * only its sha256 (renewKeys, hashedKey 'renew'). The key is random, not made from the link (security fix 8): the token hash
 * of an Auth link is the sha224 of the email and a 6-digit code, so a key made from it would let a reader of the outbox
 * rebuild a live token hash from 1 million guesses. A recovery link (a person who accepted) carries none: Madar never renews
 * an accepted invitation.
 *
 * The daily mail quota (wave 6, track V): every invitation mail counts as sign-in mail (N2), the one of users.create, of
 * users.resendInvite, of the auth.email effect and of a renewal, because Resend counts them all in its 100 a day. The place
 * has the ref of the idempotency key, so a retry keeps its place and counts once. A row with no link yet reserves its place
 * before Auth makes the link (a link lives 1 hour, so a link made on a full day would be dead in the next day's mail);
 * sendCounted then finds that place. A full day throws QuotaFull: the row waits in the outbox until the next UTC midnight
 * (processOutbox gives the attempt back), and users.invites shows no sentAt until the mail goes out. The renew route
 * reserves the place of its row under the office lock before it writes the row (renewRow, counted: true marks a renewal);
 * the reserve here takes only the mail lock, in a transaction of its own, so the lock order stays office lock, then mail lock.
 * A row with no link gives way to a later auth.invite row of the same person (laterInvite): on a full day the Admin can
 * resend up to 5 times, and on the next day only the last row takes a place and sends.
 */

export const INVITE_KIND = 'auth.invite';

export type SigninLink = { type: 'invite' | 'recovery'; authUserId: string; tokenHash: string };
export type Person = { user: User; authUserId: string | null };

const Payload = z.looseObject({
  userId: z.string().min(1),
  inviteId: z.string().min(1),
  tokenHash: z.string().min(1).optional(),
  renewKey: z.string().min(1).optional(),
  authUserId: z.string().min(1).optional(),
  linkType: z.enum(['invite', 'recovery']).optional(),
  sentAt: z.string().optional(),
  counted: z.boolean().optional(),
});

export interface InviteStore {
  person(userId: string): Promise<Person | undefined>;
  /** Merges fields into the payload of the row with this invite id (the auth.email effect notes what it still owes). */
  note(inviteId: string, fields: Record<string, unknown>): Promise<void>;
  /** True when a later auth.invite or auth.email row of this person already made a link: the link of this row is dead. */
  newerLink(userId: string, inviteId: string): Promise<boolean>;
  /** True when a later auth.invite row of this person sends the newest invitation (LATER_INVITE_SQL): this row with no link gives way. */
  laterInvite(userId: string, inviteId: string): Promise<boolean>;
  /** Keeps the link in the payload of the row with this invite id; relink: also write users.auth_user_id. One transaction. */
  keepLink(inviteId: string, userId: string, link: SigninLink, relink: boolean): Promise<void>;
  /** Marks the row as sent and drops its token hash and its renew key. */
  markSent(inviteId: string, at: Date, mailId: string): Promise<void>;
  /** Keeps one renew key in the row with this invite id until the send, and adds its sha256 (hashedKey 'renew') to the row. */
  keepRenewKey(inviteId: string, key: string, hash: string): Promise<void>;
}

export const PERSON_SQL = 'select doc, auth_user_id::text as auth from users where id = $1';
/** The payload of the row with this invite id gains the given fields. Any kind: auth.email rows carry an invite id too. */
export const PAYLOAD_MERGE_SQL = "update outbox set payload = payload || $2::jsonb where payload->>'inviteId' = $1";
/** Sent: the payload gains sentAt and the mail id, and loses the token hash and the renew key. linkType stays (newerLink reads it). */
export const SENT_SQL =
  "update outbox set payload = (payload - '{tokenHash,renewKey}'::text[]) || $2::jsonb where payload->>'inviteId' = $1";
/**
 * The row keeps this renew key ($2) until the send, and gains its hash ($3) after the earlier ones, unless it already holds it
 * (a retry of the same link).
 */
export const RENEW_KEY_SQL =
  "update outbox set payload = jsonb_set(payload || jsonb_build_object('renewKey', $2::text), '{renewKeys}', " +
  "coalesce(payload->'renewKeys', '[]'::jsonb) || to_jsonb($3::text)) " +
  "where payload->>'inviteId' = $1 and not coalesce(payload->'renewKeys', '[]'::jsonb) ? $3";
/** A later row of the same person that made a link. linkType marks a row that made one, sent or not. */
export const NEWER_LINK_SQL =
  "select 1 as found from outbox where kind in ('auth.invite', 'auth.email') and payload->>'userId' = $1 and payload ? 'linkType' " +
  "and id > (select id from outbox where payload->>'inviteId' = $2 limit 1) limit 1";

/**
 * A later auth.invite row of the same person that is still to run or that sent its mail. A later row that ended with no mail
 * (the person was turned off then) does not count: users.reactivate writes no new invitation, so this row still owes it.
 */
export const LATER_INVITE_SQL =
  "select 1 as found from outbox where kind = 'auth.invite' and payload->>'userId' = $1 and (done_at is null or payload ? 'sentAt') " +
  "and id > (select id from outbox where payload->>'inviteId' = $2 limit 1) limit 1";

export function sqlInviteStore(deps: Pick<Deps, 'db' | 'config'>): InviteStore {
  return {
    async person(userId) {
      const [row] = await deps.db.statement<{ doc: unknown; auth: string | null }>('read', PERSON_SQL, [userId]);
      if (!row) return undefined;
      return { user: User.parse(row.doc), authUserId: row.auth };
    },
    async note(inviteId, fields) {
      await deps.db.statement('write', PAYLOAD_MERGE_SQL, [inviteId, JSON.stringify(fields)]);
    },
    async newerLink(userId, inviteId) {
      return (await deps.db.statement('read', NEWER_LINK_SQL, [userId, inviteId])).length > 0;
    },
    async laterInvite(userId, inviteId) {
      return (await deps.db.statement('read', LATER_INVITE_SQL, [userId, inviteId])).length > 0;
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
      await deps.db.statement('write', SENT_SQL, [inviteId, JSON.stringify({ sentAt: at.toISOString(), mailId })]);
    },
    async keepRenewKey(inviteId, key, hash) {
      await deps.db.statement('write', RENEW_KEY_SQL, [inviteId, key, hash]);
    },
  };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function randomBase32(n: number): string {
  let text = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(n))) text += BASE32[byte & 31];
  return text;
}

/** 22 random base32 characters, as story ids use. */
export function newInviteId(): string {
  return `inv_${randomBase32(22)}`;
}

/** The query parameter of the renew key in a Welcome link. */
export const RENEW_PARAM = 'renew';

/** A new renew key: 52 random base32 characters (260 bits). It names no person and no link. */
export function newRenewKey(): string {
  return randomBase32(52);
}

/** The idempotency key of an invitation mail, and the ref of its place in the daily mail quota. */
export const mailKey = (inviteId: string) => `invite:${inviteId}`;

const QUOTA_FULL = 'The invitation did not go out: the daily mail quota is full. The job sends it on the next UTC day.';

/** The outbox row of one invitation (auth.invite), or of another kind that may send one (auth.email). */
export function inviteRow(userId: string, kind: string = INVITE_KIND): OutboxRow {
  return { kind, payload: { userId, inviteId: newInviteId() } };
}

/** The outbox row of a renewal (server/auth/renew.ts). counted marks a renewal; every invitation mail counts against the daily quota. */
export function renewRow(userId: string): OutboxRow {
  return { kind: INVITE_KIND, payload: { userId, inviteId: newInviteId(), counted: true } };
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
  /** The renew key that an earlier attempt kept with the stored link. */
  let kept: string | undefined;
  if (payload.tokenHash && payload.authUserId && payload.linkType) {
    if (await store.newerLink(payload.userId, payload.inviteId)) {
      deps.log.info('An invitation was not sent: a later invitation of the person made a newer link.', { userId: payload.userId });
      return 'skipped';
    }
    link = { type: payload.linkType, authUserId: payload.authUserId, tokenHash: payload.tokenHash };
    kept = payload.renewKey;
  } else {
    // A row that waited for a day with room gives way to a later invitation of the person: that row sends the newest mail, and
    // this one would take a place for a link that the later one kills (on the day after a full day, when places are tight).
    if (await store.laterInvite(payload.userId, payload.inviteId)) {
      deps.log.info('An invitation was not sent: a later invitation of the person sends the newest mail.', { userId: payload.userId });
      return 'skipped';
    }
    // The place in today's quota first: a full day makes no link (above).
    const now = deps.clock.now();
    if ((await deps.db.tx('write', (q) => reserve(q, 'signin', mailKey(payload.inviteId), { now, userId: payload.userId }))) === 'over') {
      throw new QuotaFull(QUOTA_FULL, now);
    }
    link = await linkFor(deps.authAdmin, person.user.email);
    await store.keepLink(payload.inviteId, payload.userId, link, link.authUserId !== person.authUserId);
    const again = await store.person(payload.userId);
    if (!again || !again.user.active) {
      await deps.authAdmin.setBanned(link.authUserId, true);
      deps.log.info('An invitation was not sent: the person was turned off while the link was made.', { userId: payload.userId });
      return 'skipped';
    }
  }
  const { user } = person;
  // The renew key of this link: made once, then kept with the link until the send, so each attempt mails the same key. A
  // recovery link (the person accepted) gets none.
  let renew: string | undefined;
  if (link.type === 'invite') {
    renew = kept ?? newRenewKey();
    await store.keepRenewKey(payload.inviteId, renew, await hashedKey('renew', renew));
  }
  const mail = {
    to: user.email,
    ...renderSigninMail('invite', user.preferences.language, {
      name: user.name, link: signinLink(deps.config.appUrl, 'welcome', link.tokenHash, link.type, renew),
    }, user.gender, { appUrl: deps.config.appUrl }),
    tag: 'invite',
    idempotencyKey: mailKey(payload.inviteId),
  };
  const sent = await sendCounted(deps, 'signin', mail, { userId: user.id });
  if (sent.status === 'over') throw new QuotaFull(QUOTA_FULL, deps.clock.now());
  await store.markSent(payload.inviteId, deps.clock.now(), sent.id);
  return 'sent';
}
