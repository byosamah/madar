import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import { invalid } from '../../src/api/errors';
import { requestHost, type RequestHost } from '../core/after';
import { processOutbox, writeOutbox } from '../core/effects';
import { takeOfficeLock } from '../core/lock';
import type { Deps, Query } from '../core/ports';
import { sqlFor, statementQuery } from '../data/dialect';
import { errorResponse, runErrorOf } from '../http/errors';
import { reserve } from '../mail/quota';
import { authAdminOf } from './admin';
import { clientAddress } from './forgot';
import { mailKey, NEWER_LINK_LITE, NEWER_LINK_SQL, PAYLOAD_MERGE_LITE, PAYLOAD_MERGE_SQL, PERSON_LITE, PERSON_SQL, renewRow } from './invite';
import { hashedKey, hitLimit } from './rateLimit';

/**
 * POST /api/auth/renew-invite { key } (security fix 7, wave 5 track H). The Welcome screen sends it with no sign-in, when the
 * link of an invitation is out of date (an Auth link lives 1 hour, otp_expiry). It follows the rules of server/auth/forgot.ts.
 *
 * - The key: the opaque renew key of the invitation mail (server/auth/invite.ts). It names no person and no email; the outbox
 *   row of that mail keeps only its sha256 (renewKeys). The route never takes an address from the request: the new invitation
 *   goes to the address that Madar holds for the person of that row.
 * - The same answer, { v: 1, ok: true } with 200, for every key: a good one, an unknown one, a used one, one of a removed person,
 *   one of a person who accepted, one that a newer invitation replaced, and one whose mail did not go out. Only a good key
 *   sends anything.
 * - The time of the answer: as the forgot route, the route answers first and does the lookup and the send with after (when the
 *   host gives one), and the answer waits until it took at least minMs (1.5 s).
 * - Limits counted before the lookup, so they say nothing about the key: 3 an hour for each key and 10 an hour for each network
 *   address (cf-connecting-ip only, clientAddress of forgot.ts). Over a limit: 429 with the reason too_many. The keys of
 *   rate_limits hold only a sha256.
 * - A good key: the mail of the key went out (security fix 8); the row of the key (auth.invite or auth.email) is not renewed
 *   yet; no later row of the person made a newer link (an Admin resend, an email change, an earlier renewal); the person is a
 *   human who is on and has a sign-in link; and the person did not accept yet (no confirmed email with a saved password, as
 *   users.invites). Then, after the answer, one
 *   transaction under the office lock:
 *   1. The row of the key is read again. A second press at the same moment finds the mark of the first (below) and stops here,
 *      so it counts nothing.
 *   2. A limit for each person, silent (same answer): 3 renewals a day, so a person who opens the mail again and again cannot
 *      use up the daily mail quota.
 *   3. The place in the daily mail quota as sign-in mail (N2), before any link: a full day makes no link, sends nothing, logs a
 *      warning, and leaves the key unused for a day with room.
 *   A refusal of 2 or 3 rolls the whole transaction back. Else the row of the key is marked renewedAt (a key works once), and a
 *   new auth.invite row (renewRow, counted) goes into the outbox.
 *   4. processOutbox runs the row: a new invite link (which ends the old one), and the invitation mail with a new renew key.
 *      A failure leaves the row for the 15-minute job.
 * - A failure of the database, of Auth or of the mail is logged and gives the same answer.
 * - The Admin does nothing, and no event is written: the invitation is the same one, sent again.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const RENEW_PATH = '/auth/renew-invite';
export const RENEW_KEY_PER_HOUR = 3;
export const RENEW_IP_PER_HOUR = 10;
export const RENEW_PERSON_PER_DAY = 3;
export const RENEW_MIN_MS = 1500;

/**
 * The newest row whose mail held this key ($1: hashedKey 'renew' of the key), whether its mail went out, and whether it was
 * renewed.
 */
export const RENEW_ROW_SQL =
  "select id::text as id, payload->>'userId' as user_id, payload->>'inviteId' as invite_id, payload ? 'sentAt' as sent, " +
  "payload ? 'renewedAt' as renewed from outbox " +
  "where kind in ('auth.invite', 'auth.email') and payload->'renewKeys' ? $1 order by id desc limit 1";
/** The SQLite form (Supabase exit, wave 2). No order by: renewInvitation picks the newest row in JavaScript (wave 0 rule). */
export const RENEW_ROW_LITE =
  "select cast(id as text) as id, json_extract(payload, '$.userId') as user_id, json_extract(payload, '$.inviteId') as invite_id, " +
  "json_type(payload, '$.sentAt') is not null as sent, json_type(payload, '$.renewedAt') is not null as renewed from outbox " +
  "where kind in ('auth.invite', 'auth.email') and exists (select 1 from json_each(payload, '$.renewKeys') where value = ?1)";

/** A limit or the quota refused the renewal: the transaction rolls back, and the key stays unused. */
class Refused extends Error {}

const Body = z.object({ key: z.string().trim().min(1).max(200) });

type KeyRow = { id: string; user_id: string; invite_id: string; sent: boolean | number; renewed: boolean | number };

/** The newest row of a key. SQLite gives sent and renewed as 1 or 0, Postgres as true or false. */
function newestOf(rows: KeyRow[]): KeyRow | undefined {
  return rows.reduce<KeyRow | undefined>((best, row) => (!best || Number(row.id) > Number(best.id) ? row : best), undefined);
}

/**
 * A key works only after its mail went out. Until then the row keeps the plain key next to the token hash (a retry mails the
 * same key), and the send drops it in the statement that writes sentAt (SENT_SQL), so a plain key that a reader of the outbox
 * finds never works (security fix 8).
 */
const usable = (row: KeyRow | undefined): row is KeyRow => row !== undefined && Boolean(row.sent) && !row.renewed;

/** Sends a new invitation when the key is good. Otherwise nothing. */
export async function renewInvitation(key: string, deps: Deps, o: { afterCommit?: (deps: Deps, ids: string[]) => Promise<unknown> } = {}): Promise<'sent' | 'none'> {
  const hash = await hashedKey('renew', key);
  const row = newestOf(await deps.db.statement<KeyRow>('read', sqlFor(deps.db, RENEW_ROW_SQL, RENEW_ROW_LITE), [hash]));
  if (!usable(row)) return 'none';
  const [person] = await deps.db.statement<{ doc: unknown; auth: string | null }>('read', sqlFor(deps.db, PERSON_SQL, PERSON_LITE), [row.user_id]);
  if (!person || person.auth === null) return 'none';
  const user = User.parse(person.doc);
  if (user.kind !== 'human' || !user.active) return 'none';
  if ((await deps.db.statement('read', sqlFor(deps.db, NEWER_LINK_SQL, NEWER_LINK_LITE), [row.user_id, row.invite_id])).length > 0) return 'none';
  const signIn = await authAdminOf(deps.authAdmin).getUser(person.auth);
  // Accepted means a confirmed email AND a saved password (PASSWORD_SET_MARK), as users.invites says. A person who opened the
  // link and left still gets a new link: a recovery link, because Auth refuses an invite link for a confirmed email.
  // The person can write the mark (user_metadata). That is safe here: a wrong mark only sends a recovery link, once per key,
  // to the address Madar holds, which "Forgot password" gives anyone anyway; no right reads the mark (security review 2026-10-04).
  if (!signIn || (signIn.confirmed && signIn.passwordSet)) return 'none';

  const now = deps.clock.now();
  const next = renewRow(user.id);
  // One transaction under the office lock: a press that finds the key used counts nothing, and a refusal rolls back the hit of
  // the person and the place in the quota. The mail lock of reserve comes after the office lock; no code takes them the other way.
  let ids: string[];
  try {
    ids = await deps.db.tx('write', async (t) => {
      await takeOfficeLock(t, deps.config.lockKey);
      const again = newestOf(await t<KeyRow>(sqlFor(t, RENEW_ROW_SQL, RENEW_ROW_LITE), [hash]));
      if (!usable(again) || again.id !== row.id) return [] as string[];
      if (!(await hitLimit(t, { key: `renew:person:${user.id}`, limit: RENEW_PERSON_PER_DAY, windowMs: DAY_MS, now })).ok) {
        throw new Refused('A renewed invitation did not go out: the person asked too often today.');
      }
      if ((await reserve(t, 'signin', mailKey(String(next.payload.inviteId)), { now, userId: user.id })) === 'over') {
        throw new Refused('A renewed invitation did not go out: the daily mail quota is full.');
      }
      await t(sqlFor(t, PAYLOAD_MERGE_SQL, PAYLOAD_MERGE_LITE), [row.invite_id, JSON.stringify({ renewedAt: now.toISOString() })]);
      return writeOutbox(t, [next]);
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    deps.log.warn(error.message, { userId: user.id });
    return 'none';
  }
  if (ids.length === 0) return 'none';
  try {
    await (o.afterCommit ?? processOutbox)(deps, ids);
  } catch (error) {
    deps.log.warn('The renewed invitation did not run. The job tries it again.', { userId: user.id, error: error instanceof Error ? error.message : String(error) });
  }
  return 'sent';
}

/** Over a limit of the key or of the network address. */
function tooMany(retryAfterMs: number): Response {
  return errorResponse({ code: 'conflict', message: 'Too many tries. Wait a few minutes, then try again.', details: { reason: 'too_many', retryAfterMs } });
}

export function createRenewRoute(o: { minMs?: number; sleep?: (ms: number) => Promise<void>; host?: () => RequestHost } = {}) {
  const minMs = o.minMs ?? RENEW_MIN_MS;
  const hostOf = o.host ?? requestHost;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async function renewRoute(request: Request, deps: Deps): Promise<Response> {
    const started = performance.now();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) return errorResponse(runErrorOf(invalid('key', 'Open the link of your invitation email again.')));
    const { key } = parsed.data;

    const { after } = hostOf();
    const q: Query = statementQuery(deps.db, 'write');
    const now = deps.clock.now();
    const byAddress = await hitLimit(q, { key: await hashedKey('renew:ip', clientAddress(request)), limit: RENEW_IP_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byAddress.ok) return tooMany(byAddress.retryAfterMs);
    const byKey = await hitLimit(q, { key: await hashedKey('renew:key', key), limit: RENEW_KEY_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byKey.ok) return tooMany(byKey.retryAfterMs);

    const work = renewInvitation(key, deps).catch((error: unknown) => {
      deps.log.warn('A renewed invitation did not go out.', { error: error instanceof Error ? error.message : String(error) });
    });
    if (after) after(work);
    else await work;
    const spent = performance.now() - started;
    if (spent < minMs) await sleep(minMs - spent);
    return Response.json({ v: 1, ok: true });
  };
}

/** The route that server/http/routes.ts mounts. */
export const renewRoute: (request: Request, deps: Deps) => Promise<Response> = createRenewRoute();
