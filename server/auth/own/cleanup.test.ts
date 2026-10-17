import { describe, expect, it } from 'vitest';
import { freshLite } from '../../data/lite/testDb';
import { cleanupSignin } from './cleanup';

describe('the cleanup of old sign-in rows (server/auth/own/cleanup.ts)', () => {
  it('deletes the links, requests and sessions that ended more than a day ago, and keeps the rest', async () => {
    const { raw, db } = await freshLite();
    raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old', 'a', 'invite', '2026-10-15T00:00:00.000Z'), ('new', 'a', 'invite', '2026-10-17T07:00:00.000Z')`);
    raw.exec(`insert into oauth_requests (id, client_id, redirect_uri, code_challenge, expires_at) values ('old', 'c', 'x', 'y', '2026-10-15T00:00:00.000Z'), ('new', 'c', 'x', 'y', '2026-10-17T06:10:00.000Z')`);
    raw.exec(`insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at, revoked_at) values
      ('ended', 'a', 'password', 'h1', '2026-10-15T00:00:00.000Z', null), ('revoked', 'a', 'password', 'h2', '2026-11-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z'),
      ('just-revoked', 'a', 'password', 'h3', '2026-11-15T00:00:00.000Z', '2026-10-17T05:00:00.000Z'), ('live', 'a', 'password', 'h4', '2026-11-15T00:00:00.000Z', null)`);
    await db.tx('write', (q) => cleanupSignin(q, new Date('2026-10-17T06:00:00Z')));
    expect(raw.prepare('select token_hash from auth_links').all()).toEqual([{ token_hash: 'new' }]);
    expect(raw.prepare('select id from oauth_requests').all()).toEqual([{ id: 'new' }]);
    expect(raw.prepare('select id from auth_sessions order by id').all()).toEqual([{ id: 'just-revoked' }, { id: 'live' }]);
  });
});
