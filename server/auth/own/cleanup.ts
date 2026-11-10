import type { Query } from '../../core/ports';

/**
 * The old sign-in rows (Supabase exit, wave 2): links, OAuth requests and sessions that ended more than a day ago. The Cron of
 * wave 3 runs it once a day on the office object. Each delete is a row written of the Free day limit (wave 0), and these tables
 * stay small (some hundred rows), so a scan reads little. A deleted session only makes an old refresh token unknown: it ends anyway.
 * The displaced hashes of a session (review 2026-11-10) go with the session, after it.
 *
 * ?1 is the time one day before now. Each text binds only the values up to its highest ?N (SQLite refuses an extra value).
 */
export const SIGNIN_CLEANUP_LITE = [
  'delete from auth_links where expires_at < ?1',
  'delete from oauth_requests where expires_at < ?1',
  'delete from auth_sessions where expires_at < ?1 or (revoked_at is not null and revoked_at < ?1)',
  'delete from auth_old_hashes where session_id not in (select id from auth_sessions)',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The values of one text: as many as its highest ?N names. */
function valuesFor(text: string, values: readonly string[]): string[] {
  const highest = Math.max(0, ...[...text.matchAll(/\?(\d+)/g)].map((match) => Number(match[1])));
  return values.slice(0, highest);
}

export async function cleanupSignin(q: Query, now: Date): Promise<void> {
  const values = [new Date(now.getTime() - DAY_MS).toISOString()];
  for (const text of SIGNIN_CLEANUP_LITE) await q(text, valuesFor(text, values));
}
