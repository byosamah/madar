import { ApiError } from '../../../src/api/errors';
import type { Query } from '../../core/ports';
import type { LiteDb } from '../../data/lite/db';
import { readLiteOffice } from '../../data/lite/office';
import { userIdOfAuth } from '../../data/officeCache';
import { ACCESS_TTL_S } from '../ownKeys';
import { principalOf } from '../principal';
import { hitLimit } from '../rateLimit';
import { signBrowserToken } from './keys';
import {
  AGENT_LINK_STATE, AUTH_USER_BY_ID, SESSION_BY_PREV, SESSION_BY_REFRESH, SESSION_END, SESSION_INSERT, SESSION_ROTATE, type Amr,
  type AuthUserRow, type SessionRow,
} from './rows';
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

type Rotation = { kind: 'ok'; row: SessionRow } | { kind: 'ended' };

/**
 * One refresh with rotation (OAuth 2.1, section 4.3.1). The presented hash is the current refresh hash of a live session, or its
 * previous one within REFRESH_REUSE_MS (two tabs, or a lost answer): both rotate. The previous one after the window ends the whole
 * session, in a transaction that commits (a throw would roll the end back). clientId null is a browser session; a refresh of a
 * turned-off person throws account_off, and of a banned person, an agent whose link is removed or a turned-off owner, session_ended.
 */
export async function rotateSession(deps: SigninDeps, o: { hash: string; nextHash: string; clientId: string | null }): Promise<SessionRow> {
  const now = deps.clock.now();
  const out = await deps.db.tx('write', async (q): Promise<Rotation> => {
    let [row] = await q<SessionRow>(SESSION_BY_REFRESH, [o.hash]);
    if (!row) {
      const [old] = await q<SessionRow>(SESSION_BY_PREV, [o.hash]);
      if (!old) return { kind: 'ended' };
      const inWindow = old.rotated_at !== null && now.getTime() - Date.parse(old.rotated_at) <= REFRESH_REUSE_MS;
      if (!inWindow) {
        await q(SESSION_END, [old.id, now.toISOString()]);
        return { kind: 'ended' };
      }
      row = old;
    }
    if (row.revoked_at !== null || row.expires_at <= now.toISOString() || (row.client_id ?? null) !== o.clientId) return { kind: 'ended' };
    const [user] = await q<AuthUserRow>(AUTH_USER_BY_ID, [row.auth_id]);
    if (!user || user.banned === 1) return { kind: 'ended' };
    const office = await readLiteOffice(deps.db as LiteDb, q);
    if (o.clientId === null) {
      principalOf(row.auth_id, office);
    } else {
      const ownerId = userIdOfAuth(office, row.auth_id);
      const [link] = await q<{ revoked_at: string | null }>(AGENT_LINK_STATE, [o.clientId]);
      if (ownerId === undefined || office.lists.users[ownerId]?.active !== true || (link !== undefined && link.revoked_at !== null)) return { kind: 'ended' };
    }
    await q(SESSION_ROTATE, [row.id, o.nextHash, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString()]);
    return { kind: 'ok', row };
  });
  if (out.kind !== 'ok') throw sessionEnded();
  return out.row;
}
