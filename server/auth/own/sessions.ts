import { ApiError } from '../../../src/api/errors';
import type { Query } from '../../core/ports';
import { ACCESS_TTL_S } from '../ownKeys';
import { hitLimit } from '../rateLimit';
import { signBrowserToken } from './keys';
import { SESSION_INSERT, type Amr } from './rows';
import type { SigninDeps, TokenAnswer } from './types';

/** A session lives 30 days after its last refresh. */
export const SESSION_DAYS = 30;
/** A second use of the old refresh token within 10 s rotates again (refresh_token_reuse_interval = 10 of supabase/config.toml). */
export const REFRESH_REUSE_MS = 10_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionEnded(): ApiError {
  return new ApiError('unauthenticated', 'This sign-in ended. Sign in again.', { reason: 'session_ended' });
}

export function tooMany(retryAfterMs: number): ApiError {
  return new ApiError('conflict', 'Too many tries. Wait a few minutes, then try again.', { reason: 'too_many', retryAfterMs });
}

/** Counts one hit of each key in one transaction; the first key over its limit refuses the step. The keys are hashed before. */
export async function countLimits(deps: SigninDeps, keys: { key: string; limit: number; windowMs: number }[]): Promise<void> {
  const now = deps.clock.now();
  const over = await deps.db.tx('write', async (q) => {
    for (const one of keys) {
      const hit = await hitLimit(q, { ...one, now });
      if (!hit.ok) return hit;
    }
    return null;
  });
  if (over) throw tooMany(over.retryAfterMs);
}

/** A new session row, inside the write transaction of a step. The refresh hash comes from before the transaction. */
export async function insertSession(q: Query, o: { authId: string; clientId: string | null; amr: Amr; refreshHash: string; linkUntil: Date | null; now: Date }): Promise<string> {
  const id = crypto.randomUUID();
  await q(SESSION_INSERT, [id, o.authId, o.clientId, o.amr, o.refreshHash, o.linkUntil?.toISOString() ?? null, new Date(o.now.getTime() + SESSION_DAYS * DAY_MS).toISOString(), o.now.toISOString()]);
  return id;
}

/** The token answer of a browser session, signed after the commit. */
export async function browserAnswer(deps: SigninDeps, o: { authId: string; sessionId: string; refresh: string }): Promise<TokenAnswer> {
  const accessToken = await signBrowserToken(deps.keys, { authId: o.authId, sessionId: o.sessionId, now: deps.clock.now() });
  return { access_token: accessToken, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: o.refresh, user: { id: o.authId } };
}
