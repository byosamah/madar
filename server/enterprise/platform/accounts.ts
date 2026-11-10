import { ApiError } from '../../../src/api/errors';
import type { SigningKeys } from '../../auth/own/keys';
import { knowableAddress, type KnownKey } from '../../auth/own/knownKey';
import { signPlatformToken } from '../../auth/own/keys';
import { randomToken, sha256Hex } from '../../auth/own/crypto';
import {
  ADDRESS_LIMITS, KNOWN_ADDRESS_DAYS, KNOWN_ADDRESS_TOUCH_MS, SIGNIN_PER_EMAIL, SIGNIN_PER_EMAIL_TOTAL, SIGNIN_WINDOW_MS,
} from '../../auth/own/limits';
import { accountOff, wrongCredentials } from '../../auth/own/ops';
import { hashPassword, verifyPassword } from '../../auth/own/password';
import { countLimits, DAY_MS, SESSION_DAYS, sessionEnded } from '../../auth/own/sessions';
import { ACCESS_TTL_S } from '../../auth/ownKeys';
import { hashedKey, limitAddress } from '../../auth/rateLimit';
import type { Clock, Query } from '../../core/ports';
import type { RunError } from '../../core/types';
import { runErrorOf } from '../../http/errors';
import type { LiteDb } from '../../data/lite/db';
import { isPlatformAccountId, normalizeEmail } from '../ids';

/**
 * The accounts of the platform (Madar enterprises, design D8): the people who run Madar enterprises. An account belongs to no company, and
 * it lives only in the platform object: email, name, password hash, state, and its sessions. The sign-in follows the own sign-in of the
 * companies (server/auth/own): PBKDF2 between two transactions, a refresh token that rotates with a 10 s reuse window (PLATFORM_REUSE_MS),
 * the same answer for a wrong password and an unknown email. The tokens carry the audience madar-platform and no ent (signPlatformToken).
 * The two rules of the review of 2026-11-10 apply too, on their own tables: a displaced refresh token ends its session
 * (platform_old_hashes), and a known address skips the total stop of the email (platform_known_addresses).
 */

/** The shortest password of a platform account. The Mac script refuses a shorter one as well. */
export const PLATFORM_PASSWORD_MIN = 12;
/** The longest password: it bounds the work of the hash for any input. */
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
const NAME_MAX = 120;
/** Own key prefixes, so a try on the platform page never counts against the sign-in of a company. */
const ADDRESS_PREFIX = 'psignin:ip';
const PAIR_PREFIX = 'psignin:pair';
const EMAIL_PREFIX = 'psignin:email';
/** The key prefix of a known address of a platform account (the companies use 'known'). The key is an HMAC under the server secret (d.knownKey). */
const KNOWN_PREFIX = 'pknown';
/**
 * The reuse window of a platform refresh token: 10 s (task D5b). The 60 s of a company browser (REFRESH_REUSE_MS) is for the phones of a
 * team on a weak network. A platform account gains nothing from it, and a longer window only helps a thief with a stolen refresh token.
 */
export const PLATFORM_REUSE_MS = 10_000;

export type PlatformAccountState = 'active' | 'off';
export type PlatformAccountView = { id: string; name: string; email: string; state: PlatformAccountState };
export type PlatformTokenAnswer = { access_token: string; refresh_token: string; expires_in: number; account: { id: string; name: string; email: string } };
export type PlatformAccountsInput = { action: 'create' | 'password' | 'off' | 'on'; email: string; name?: string; password?: string };

/** knownKey: the pair key of a known address, an HMAC under a key from the server secret (server/auth/own/knownKey.ts, owner "platform"). */
export type AccountDeps = { db: LiteDb; clock: Clock; keys: () => Promise<SigningKeys>; knownKey: KnownKey };

type AccountRow = { id: string; email: string; name: string; password_hash: string; state: string; created_at: string };
type SessionRow = { id: string; account_id: string; refresh_hash: string; prev_hash: string | null; used_at: string | null; ends_at: string };

const ACCOUNT_BY_EMAIL = 'select id, email, name, password_hash, state, created_at from platform_accounts where email = ?1';
const ACCOUNT_BY_ID = 'select id, email, name, password_hash, state, created_at from platform_accounts where id = ?1';
const SESSION_BY_REFRESH = 'select id, account_id, refresh_hash, prev_hash, used_at, ends_at from platform_sessions where refresh_hash = ?1';
const SESSION_BY_PREV = 'select id, account_id, refresh_hash, prev_hash, used_at, ends_at from platform_sessions where prev_hash = ?1';
const SESSION_INSERT = 'insert into platform_sessions (id, account_id, refresh_hash, ends_at, created_at) values (?1, ?2, ?3, ?4, ?5)';
const SESSION_ROTATE = 'update platform_sessions set prev_hash = refresh_hash, refresh_hash = ?2, used_at = ?3, ends_at = ?4 where id = ?1';
const SESSION_END = 'update platform_sessions set ends_at = ?2 where id = ?1 and ends_at > ?2';
const SESSIONS_END_ALL = 'update platform_sessions set ends_at = ?2 where account_id = ?1 and ends_at > ?2';
/** The twins of OLD_HASH_INSERT, OLD_HASH_BY_HASH, KNOWN_BY_KEY and KNOWN_TOUCH (server/auth/own/rows.ts), with the same values. */
const OLD_HASH_INSERT = 'insert or ignore into platform_old_hashes (hash, session_id, at) values (?1, ?2, ?3)';
const OLD_HASH_BY_HASH = 'select session_id from platform_old_hashes where hash = ?1';
const KNOWN_BY_KEY = 'select seen_at from platform_known_addresses where pair_key = ?1';
const KNOWN_TOUCH =
  'insert into platform_known_addresses (pair_key, seen_at) values (?1, ?2) on conflict (pair_key) do update set seen_at = ?2 where platform_known_addresses.seen_at < ?3';

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function viewOf(row: AccountRow): PlatformAccountView {
  return { id: row.id, name: row.name, email: row.email, state: row.state === 'active' ? 'active' : 'off' };
}

async function answerOf(d: AccountDeps, o: { account: AccountRow; sessionId: string; refresh: string }): Promise<PlatformTokenAnswer> {
  const accessToken = await signPlatformToken(await d.keys(), { accountId: o.account.id, sessionId: o.sessionId, now: d.clock.now() });
  return { access_token: accessToken, refresh_token: o.refresh, expires_in: ACCESS_TTL_S, account: { id: o.account.id, name: o.account.name, email: o.account.email } };
}

/**
 * Sign in with email and password. A wrong password and an unknown email give one answer, after the same work (one PBKDF2 each). An account
 * that is off shows only after the right password. The limits use their own keys, with the rule of passwordSignIn (review 2026-11-10): the
 * address, the email with the address (10), then the total of the email (100), so a stranger at another address does not lock the account out.
 * A known address (the account signed in from it in the last KNOWN_ADDRESS_DAYS) skips the total, so strangers at 10 addresses cannot lock
 * the account out either. Only the right password writes the known row, at most once a day. The pair key is an HMAC under a key from the
 * server secret (d.knownKey, owner "platform"), so a copy of the database cannot check a guess. The fallback address 'unknown' and an empty
 * address never become known: no read, no write, and the total applies.
 */
export async function platformSignIn(d: AccountDeps, input: { email: string; password: string; address: string }): Promise<PlatformTokenAnswer> {
  const email = normalizeEmail(textOf(input.email));
  const password = textOf(input.password).slice(0, PASSWORD_MAX);
  const address = limitAddress(textOf(input.address));
  const knownKey = knowableAddress(address) ? await d.knownKey(KNOWN_PREFIX, `${email}|${address}`) : null;
  const knownSince = new Date(d.clock.now().getTime() - KNOWN_ADDRESS_DAYS * DAY_MS).toISOString();
  const [seen] = knownKey === null ? [] : await d.db.statement<{ seen_at: string }>('read', KNOWN_BY_KEY, [knownKey]);
  const known = seen !== undefined && seen.seen_at > knownSince;
  await countLimits(d, [
    { key: await hashedKey(ADDRESS_PREFIX, address), ...ADDRESS_LIMITS['auth.password'].limit },
    { key: await hashedKey(PAIR_PREFIX, `${email}|${address}`), limit: SIGNIN_PER_EMAIL, windowMs: SIGNIN_WINDOW_MS },
    ...(known ? [] : [{ key: await hashedKey(EMAIL_PREFIX, email), limit: SIGNIN_PER_EMAIL_TOTAL, windowMs: SIGNIN_WINDOW_MS }]),
  ]);
  const [found] = await d.db.statement<AccountRow>('read', ACCOUNT_BY_EMAIL, [email]);
  const check = await verifyPassword(password, found?.password_hash ?? null);
  if (!found || !check.ok) throw wrongCredentials();
  if (found.state !== 'active') throw accountOff();
  const refresh = randomToken();
  const refreshHash = await sha256Hex(refresh);
  const now = d.clock.now();
  const sessionId = crypto.randomUUID();
  const account = await d.db.tx('write', async (q) => {
    const [row] = await q<AccountRow>(ACCOUNT_BY_ID, [found.id]);
    // A new password or a turn-off between the check and this transaction: the check is old, so refuse it.
    if (!row || row.password_hash !== found.password_hash) throw wrongCredentials();
    if (row.state !== 'active') throw accountOff();
    if (knownKey !== null) await q(KNOWN_TOUCH, [knownKey, now.toISOString(), new Date(now.getTime() - KNOWN_ADDRESS_TOUCH_MS).toISOString()]);
    await q(SESSION_INSERT, [sessionId, row.id, refreshHash, new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString(), now.toISOString()]);
    return row;
  });
  return answerOf(d, { account, sessionId, refresh });
}

type Rotation = { kind: 'ok'; session: SessionRow; account: AccountRow } | { kind: 'ended' } | { kind: 'off' };

/**
 * One refresh with rotation, as rotateSession of the companies: the presented hash is the current one of a live session, or the previous one
 * within PLATFORM_REUSE_MS. The previous one after the window ends the whole session. An account that is off refuses with account_off.
 * A displaced hash (review 2026-11-10): each rotation keeps the previous hash that leaves the row in platform_old_hashes, and a later
 * refresh with it ends its session. An unknown hash ends nothing.
 */
export async function platformRefresh(d: AccountDeps, input: { refreshToken: string }): Promise<PlatformTokenAnswer> {
  const hash = await sha256Hex(textOf(input.refreshToken));
  const next = randomToken();
  const nextHash = await sha256Hex(next);
  const now = d.clock.now();
  const out = await d.db.tx('write', async (q): Promise<Rotation> => {
    let [session] = await q<SessionRow>(SESSION_BY_REFRESH, [hash]);
    if (!session) {
      const [old] = await q<SessionRow>(SESSION_BY_PREV, [hash]);
      if (!old) {
        const [displaced] = await q<{ session_id: string }>(OLD_HASH_BY_HASH, [hash]);
        if (displaced) await q(SESSION_END, [displaced.session_id, now.toISOString()]);
        return { kind: 'ended' };
      }
      const inWindow = old.used_at !== null && now.getTime() - Date.parse(old.used_at) <= PLATFORM_REUSE_MS;
      if (!inWindow) {
        await q(SESSION_END, [old.id, now.toISOString()]);
        return { kind: 'ended' };
      }
      session = old;
    }
    if (session.ends_at <= now.toISOString()) return { kind: 'ended' };
    const [account] = await q<AccountRow>(ACCOUNT_BY_ID, [session.account_id]);
    if (!account) return { kind: 'ended' };
    if (account.state !== 'active') return { kind: 'off' };
    // The previous hash leaves the row now: keep it, so a later use of it ends the session.
    if (session.prev_hash !== null) await q(OLD_HASH_INSERT, [session.prev_hash, session.id, now.toISOString()]);
    await q(SESSION_ROTATE, [session.id, nextHash, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString()]);
    return { kind: 'ok', session, account };
  });
  if (out.kind === 'off') throw accountOff();
  if (out.kind !== 'ok') throw sessionEnded();
  return answerOf(d, { account: out.account, sessionId: out.session.id, refresh: next });
}

/**
 * The clean-up of the sign-in memory of the platform accounts (review 2026-11-10), in the daily sweep of the platform object. A platform
 * session row stays after its end (the end only moves ends_at), so its displaced hashes go one day after the end, or when the row is gone.
 * A known address goes when the account did not sign in from it for KNOWN_ADDRESS_DAYS. Each delete is a row written of the Free day limit.
 */
const OLD_HASHES_CLEANUP = 'delete from platform_old_hashes where session_id not in (select id from platform_sessions where ends_at >= ?1)';
const KNOWN_CLEANUP = 'delete from platform_known_addresses where seen_at < ?1';

export async function cleanupPlatformMemory(q: Query, at: Date): Promise<void> {
  await q(OLD_HASHES_CLEANUP, [new Date(at.getTime() - DAY_MS).toISOString()]);
  await q(KNOWN_CLEANUP, [new Date(at.getTime() - KNOWN_ADDRESS_DAYS * DAY_MS).toISOString()]);
}

/** The sign-out of one session. A session id that is unknown or ended changes nothing. */
export async function platformSignOut(d: AccountDeps, input: { sessionId: string }): Promise<void> {
  await d.db.statement('write', SESSION_END, [textOf(input.sessionId), d.clock.now().toISOString()]);
}

/** The account of a token, for the guard of the platform routes. null for an id that is no account. */
export async function platformAccount(d: AccountDeps, input: { accountId: string }): Promise<PlatformAccountView | null> {
  if (!isPlatformAccountId(input.accountId)) return null;
  const [row] = await d.db.statement<AccountRow>('read', ACCOUNT_BY_ID, [input.accountId]);
  return row ? viewOf(row) : null;
}

const notFound = () => new ApiError('not_found', 'This platform account does not exist.');

function checkPassword(password: string | undefined): string {
  const text = textOf(password);
  if (text.length < PLATFORM_PASSWORD_MIN) throw new ApiError('invalid_input', `Use at least ${PLATFORM_PASSWORD_MIN} characters.`, { reason: 'weak', field: 'password' });
  if (text.length > PASSWORD_MAX) throw new ApiError('invalid_input', `Use at most ${PASSWORD_MAX} characters.`, { reason: 'weak', field: 'password' });
  return text;
}

function checkEmail(raw: string): string {
  const email = normalizeEmail(textOf(raw));
  if (email.length < 3 || email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('invalid_input', 'This is not an email.', { field: 'email' });
  return email;
}

const nextId = (ids: readonly string[]): string => `pla_${String(ids.reduce((top, id) => Math.max(top, Number(id.slice(4))), 0) + 1).padStart(3, '0')}`;

/**
 * The ops of the Mac script (design D13): create an account, set a new password (it ends every session), turn it off (sign-in and refresh
 * stop, and the guard refuses a token still valid), or turn it on again. It never returns a hash.
 */
export async function platformAccounts(d: AccountDeps, input: PlatformAccountsInput): Promise<PlatformAccountView> {
  const email = checkEmail(input.email);
  const now = d.clock.now().toISOString();
  if (input.action === 'create') {
    const name = textOf(input.name).trim();
    if (name === '' || name.length > NAME_MAX) throw new ApiError('invalid_input', 'Give a name of 1 to 120 characters.', { field: 'name' });
    const hash = await hashPassword(checkPassword(input.password));
    return d.db.tx('write', async (q) => {
      const [taken] = await q<{ id: string }>('select id from platform_accounts where email = ?1', [email]);
      if (taken) throw new ApiError('conflict', 'This email is taken.', { reason: 'email_taken' });
      const id = nextId((await q<{ id: string }>('select id from platform_accounts')).map((row) => row.id));
      await q('insert into platform_accounts (id, email, name, password_hash, state, created_at) values (?1, ?2, ?3, ?4, ?5, ?6)', [id, email, name, hash, 'active', now]);
      return { id, name, email, state: 'active' as const };
    });
  }
  if (input.action === 'password') {
    const hash = await hashPassword(checkPassword(input.password));
    return d.db.tx('write', async (q) => {
      const [row] = await q<AccountRow>(ACCOUNT_BY_EMAIL, [email]);
      if (!row) throw notFound();
      await q('update platform_accounts set password_hash = ?2 where id = ?1', [row.id, hash]);
      await q(SESSIONS_END_ALL, [row.id, now]);
      return viewOf(row);
    });
  }
  if (input.action !== 'off' && input.action !== 'on') throw new ApiError('invalid_input', 'The action is create, password, off or on.', { field: 'action' });
  const state: PlatformAccountState = input.action === 'on' ? 'active' : 'off';
  return d.db.tx('write', async (q) => {
    const [row] = await q<AccountRow>(ACCOUNT_BY_EMAIL, [email]);
    if (!row) throw notFound();
    await q('update platform_accounts set state = ?2 where id = ?1', [row.id, state]);
    return viewOf({ ...row, state });
  });
}

/**
 * The answer of an object method that can refuse. A thrown ApiError crosses the RPC hop of a Durable Object as a plain error whose class is
 * lost, so the platform object returns the refusal as data (as runSigninOp does for the sign-in steps) and the Worker throws it again.
 */
export type PlatformOutcome<T> = { ok: true; value: T } | { ok: false; error: RunError };

export async function outcomeOf<T>(work: () => Promise<T>): Promise<PlatformOutcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    // Only a Madar refusal becomes data. Any other error is a defect: it stays an error, and the Worker logs it.
    if (error instanceof ApiError) return { ok: false, error: runErrorOf(error) };
    throw error;
  }
}

/** The value of an outcome, or the refusal thrown as an ApiError (on the Worker side of the hop). */
export function valueOfOutcome<T>(out: PlatformOutcome<T>): T {
  if (out.ok) return out.value;
  throw new ApiError(out.error.code as ApiError['code'], out.error.message, out.error.details ?? {});
}
