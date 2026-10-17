import { ApiError } from '../../../src/api/errors';
import type { LiteDb } from '../../data/lite/db';
import { readLiteOffice } from '../../data/lite/office';
import { principalOf } from '../principal';
import { hashedKey } from '../rateLimit';
import { randomToken, sha256Hex } from './crypto';
import { SIGNIN_PER_ADDRESS, SIGNIN_PER_EMAIL, SIGNIN_WINDOW_MS } from './limits';
import { hashPassword, verifyPassword } from './password';
import { AUTH_USER_BY_EMAIL, AUTH_USER_BY_ID, AUTH_USER_SIGNED_IN, type AuthUserRow } from './rows';
import { browserAnswer, countLimits, insertSession } from './sessions';
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

const liteOf = (deps: SigninDeps) => deps.db as LiteDb;

/**
 * POST /api/auth/token { grant_type: 'password' }. A wrong password, an unknown email and a row with no password give one answer,
 * in about the same time (one PBKDF2 each). A ban or a turn-off shows only after the right password.
 */
export async function passwordSignIn(deps: SigninDeps, input: { email: string; password: string; address: string }): Promise<TokenAnswer> {
  const email = input.email.trim().toLowerCase();
  await countLimits(deps, [
    { key: await hashedKey('signin:ip', input.address), limit: SIGNIN_PER_ADDRESS, windowMs: SIGNIN_WINDOW_MS },
    { key: await hashedKey('signin:email', email), limit: SIGNIN_PER_EMAIL, windowMs: SIGNIN_WINDOW_MS },
  ]);
  const [found] = await deps.db.statement<AuthUserRow>('read', AUTH_USER_BY_EMAIL, [email]);
  const check = await verifyPassword(input.password, found?.password_hash ?? null);
  if (!found || !check.ok) throw wrongCredentials();
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
    return insertSession(q, { authId: row.id, clientId: null, amr: 'password', refreshHash, linkUntil: null, now });
  });
  return browserAnswer(deps, { authId: found.id, sessionId, refresh });
}
