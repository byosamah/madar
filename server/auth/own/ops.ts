import { ApiError } from '../../../src/api/errors';
import type { LiteDb } from '../../data/lite/db';
import { readLiteOffice } from '../../data/lite/office';
import { principalOf } from '../principal';
import { hashedKey, limitAddress } from '../rateLimit';
import { randomToken, sha256Hex } from './crypto';
import { ADDRESS_LIMITS, KNOWN_ADDRESS_DAYS, KNOWN_ADDRESS_TOUCH_MS, SIGNIN_PER_EMAIL, SIGNIN_PER_EMAIL_TOTAL, SIGNIN_WINDOW_MS } from './limits';
import { LINK_LIFE_MS } from './liteAdmin';
import { hashPassword, PASSWORD_MIN, verifyPassword } from './password';
import {
  AUTH_USER_BY_EMAIL, AUTH_USER_BY_ID, AUTH_USER_CONFIRM, AUTH_USER_PASSWORD, AUTH_USER_SIGNED_IN, KNOWN_BY_KEY, KNOWN_TOUCH, LINK_BY_HASH,
  LINKS_END, SESSION_BY_ID, SESSION_END_OWN, SESSION_LINK_DONE, SESSIONS_END_OTHERS, type AuthUserRow, type LinkRow, type SessionRow,
} from './rows';
import { browserAnswer, countLimits, DAY_MS, insertSession, rotateSession, sessionEnded } from './sessions';
import type { SigninDeps, TokenAnswer } from './types';

/**
 * The browser sign-in steps of the own stack (Supabase exit, wave 2). They run in the office object and do no network work.
 * Every step: the crypto first, then one write transaction with SQL only, then the token after the commit.
 */

export function wrongCredentials(): ApiError {
  return new ApiError('unauthenticated', 'The email or the password is not right.', { reason: 'invalid_credentials' });
}

export function accountOff(): ApiError {
  return new ApiError('unauthenticated', 'This account is turned off in Madar.', { reason: 'account_off' });
}

/**
 * The paused answer (Madar enterprises, design 5.8). It shows only after a correct password, so a stranger who types an email never learns
 * that the email exists, or that its enterprise is paused. The text is the exact sentence of the design.
 */
export function pausedSignIn(): ApiError {
  return new ApiError('unauthenticated', 'Madar is paused for your company. Ask your Admin.', { reason: 'enterprise_paused' });
}

/** The state of the enterprise of this object (the table enterprise has one row). No row reads as not paused. */
export const PAUSED_SQL = 'select state from enterprise limit 1';

const liteOf = (deps: SigninDeps) => deps.db as LiteDb;

/**
 * POST /api/auth/token { grant_type: 'password' }. A wrong password, an unknown email and a row with no password give one answer,
 * in about the same time (one PBKDF2 each). A ban or a turn-off shows only after the right password.
 */
export async function passwordSignIn(deps: SigninDeps, input: { email: string; password: string; address: string; addressChecked?: boolean }): Promise<TokenAnswer> {
  const email = input.email.trim().toLowerCase();
  // addressChecked: the Worker of the office path already counted the address in the platform object (ADDRESS_LIMITS), before it chose the
  // enterprise. Only that Worker sets it, on the object call: no route builds this input from a request field. The pair key below still
  // needs the address: the Worker passes the one that the Pages Function wrote (clientAddress).
  // The email counts with the address (owner, review 2026-11-10), so the wrong tries of a stranger at another address do not lock the
  // person out. The pair comes before the total: a try that the pair refuses does not count toward the total of the email.
  // An IPv6 address counts as its /64 block (limitAddress), so one machine has one count.
  // A known address (review 2026-11-10): the person signed in from it with the right password in the last KNOWN_ADDRESS_DAYS. It skips the
  // total of the email, so the wrong tries of strangers at 10 other addresses do not lock the person out. It still meets the pair limit.
  const address = limitAddress(input.address);
  const knownKey = await hashedKey('known', `${email}|${address}`);
  const knownSince = new Date(deps.clock.now().getTime() - KNOWN_ADDRESS_DAYS * DAY_MS).toISOString();
  const [seen] = await deps.db.statement<{ seen_at: string }>('read', KNOWN_BY_KEY, [knownKey]);
  const known = seen !== undefined && seen.seen_at > knownSince;
  await countLimits(deps, [
    ...(input.addressChecked === true ? [] : [{ key: await hashedKey(ADDRESS_LIMITS['auth.password'].prefix, address), ...ADDRESS_LIMITS['auth.password'].limit }]),
    { key: await hashedKey('signin:pair', `${email}|${address}`), limit: SIGNIN_PER_EMAIL, windowMs: SIGNIN_WINDOW_MS },
    ...(known ? [] : [{ key: await hashedKey('signin:email', email), limit: SIGNIN_PER_EMAIL_TOTAL, windowMs: SIGNIN_WINDOW_MS }]),
  ]);
  const [found] = await deps.db.statement<AuthUserRow>('read', AUTH_USER_BY_EMAIL, [email]);
  const check = await verifyPassword(input.password, found?.password_hash ?? null);
  if (!found || !check.ok) throw wrongCredentials();
  // A paused enterprise: the right password gets the calm paused answer, and no session is made (design 5.8).
  const [identity] = await deps.db.statement<{ state: string }>('read', PAUSED_SQL);
  if (identity?.state === 'paused') throw pausedSignIn();
  const upgraded = check.upgrade ? await hashPassword(input.password) : null;
  const refresh = randomToken();
  const refreshHash = await sha256Hex(refresh);
  const now = deps.clock.now();
  const sessionId = await deps.db.tx('write', async (q) => {
    const [row] = await q<AuthUserRow>(AUTH_USER_BY_ID, [found.id]);
    // A new password or a ban between the check and this transaction: the check is old, so refuse it.
    if (!row || row.password_hash !== found.password_hash) throw wrongCredentials();
    if (row.banned === 1) throw accountOff();
    principalOf(row.id, await readLiteOffice(liteOf(deps), q));
    await q(AUTH_USER_SIGNED_IN, [row.id, upgraded, now.toISOString()]);
    // The right password from this address: it is known now. At most one row written a day for each person and address.
    await q(KNOWN_TOUCH, [knownKey, now.toISOString(), new Date(now.getTime() - KNOWN_ADDRESS_TOUCH_MS).toISOString()]);
    return insertSession(q, { authId: row.id, clientId: null, amr: 'password', refreshHash, linkUntil: null, now });
  });
  return browserAnswer(deps, { authId: found.id, sessionId, refresh });
}

/** POST /api/auth/token { grant_type: 'refresh_token' }: a browser session only (an agent refreshes at /mcp/oauth/token). */
export async function refreshSignIn(deps: SigninDeps, input: { refreshToken: string }): Promise<TokenAnswer> {
  const hash = await sha256Hex(input.refreshToken);
  const next = randomToken();
  const nextHash = await sha256Hex(next);
  const row = await rotateSession(deps, { hash, nextHash, clientId: null });
  return browserAnswer(deps, { authId: row.auth_id, sessionId: row.id, refresh: next });
}

/**
 * POST /api/auth/logout. local: this session. others: every other session of the person, agents too, as Supabase signOut
 * { scope: 'others' } did (Welcome and Reset call it after a new password).
 */
export async function signOutSessions(deps: SigninDeps, input: { authId: string; sessionId: string; scope: 'local' | 'others' }): Promise<{ ok: true }> {
  const now = deps.clock.now().toISOString();
  await deps.db.tx('write', (q) => input.scope === 'local'
    ? q(SESSION_END_OWN, [input.sessionId, input.authId, now])
    : q(SESSIONS_END_OTHERS, [input.authId, input.sessionId, now]));
  return { ok: true };
}

export function linkEnded(): ApiError {
  return new ApiError('unauthenticated', 'This link ended. Ask for a new one.', { reason: 'link_ended' });
}

/**
 * POST /api/auth/verify { token_hash, type } (the Welcome and Reset buttons). A link works once, for 1 hour, for its own type,
 * and only while it is the newest link of the person. It confirms the email, ends every open link of the person, and opens a
 * link session that may set a password for 1 hour with no current password (as the otp session of Supabase did). A link of a
 * turned-off or banned person ends nothing and opens nothing.
 */
export async function verifySignInLink(deps: SigninDeps, input: { token: string; type: 'invite' | 'recovery'; address: string; addressChecked?: boolean }): Promise<TokenAnswer> {
  // addressChecked: see passwordSignIn.
  if (input.addressChecked !== true) {
    await countLimits(deps, [{ key: await hashedKey(ADDRESS_LIMITS['auth.verify'].prefix, limitAddress(input.address)), ...ADDRESS_LIMITS['auth.verify'].limit }]);
  }
  const hash = await sha256Hex(input.token);
  const refresh = randomToken();
  const refreshHash = await sha256Hex(refresh);
  const now = deps.clock.now();
  const opened = await deps.db.tx('write', async (q) => {
    const [link] = await q<LinkRow>(LINK_BY_HASH, [hash]);
    if (!link || link.type !== input.type || link.used_at !== null || link.expires_at <= now.toISOString()) throw linkEnded();
    const [user] = await q<AuthUserRow>(AUTH_USER_BY_ID, [link.auth_id]);
    if (!user || user.banned === 1) throw linkEnded();
    try {
      principalOf(user.id, await readLiteOffice(liteOf(deps), q));
    } catch {
      throw linkEnded();
    }
    await q(LINKS_END, [user.id, now.toISOString()]);
    await q(AUTH_USER_CONFIRM, [user.id, now.toISOString()]);
    const sessionId = await insertSession(q, { authId: user.id, clientId: null, amr: 'link', refreshHash, linkUntil: new Date(now.getTime() + LINK_LIFE_MS), now });
    return { authId: user.id, sessionId };
  });
  return browserAnswer(deps, { ...opened, refresh });
}

/**
 * POST /api/auth/password { password, current? }. A link session sets a password once with no current password; every other
 * session needs the right current password (the Z1 rule "require current password" of Supabase). An agent token never gets
 * here: the route refuses it (403 agent_token). The password needs 8 characters and must not be the current one.
 */
export async function setSignInPassword(deps: SigninDeps, input: { authId: string; sessionId: string; password: string; current?: string }): Promise<{ ok: true }> {
  if (input.password.length < PASSWORD_MIN) throw new ApiError('invalid_input', 'Use at least 8 characters.', { reason: 'weak', field: 'password' });
  const now = deps.clock.now();
  const [session] = await deps.db.statement<SessionRow>('read', SESSION_BY_ID, [input.sessionId]);
  const [user] = await deps.db.statement<AuthUserRow>('read', AUTH_USER_BY_ID, [input.authId]);
  if (!session || !user || session.auth_id !== user.id || session.client_id !== null || session.revoked_at !== null || user.banned === 1) throw sessionEnded();
  const byLink = session.amr === 'link' && session.link_until !== null && session.link_until > now.toISOString();
  if (!byLink) {
    if (input.current === undefined) throw new ApiError('unauthenticated', 'Type your current password.', { reason: 'current_password_required' });
    if (!(await verifyPassword(input.current, user.password_hash)).ok) throw wrongCredentials();
  }
  if (user.password_hash !== null && (await verifyPassword(input.password, user.password_hash)).ok) {
    throw new ApiError('invalid_input', 'Choose a password that is not your current one.', { reason: 'same', field: 'password' });
  }
  const hash = await hashPassword(input.password);
  await deps.db.tx('write', async (q) => {
    const [again] = await q<AuthUserRow>(AUTH_USER_BY_ID, [user.id]);
    if (!again || again.password_hash !== user.password_hash) throw sessionEnded();
    await q(AUTH_USER_PASSWORD, [user.id, hash, now.toISOString()]);
    await q(SESSION_LINK_DONE, [session.id]);
  });
  return { ok: true };
}
