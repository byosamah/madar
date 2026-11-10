import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { exchangeToken } from '../../mcp/oauth/ops';
import { passwordSignIn, refreshSignIn, signOutSessions } from './ops';
import { rotateSession } from './sessions';
import { addSignIn, bareToken, signinDepsOf, signinOffice } from './testOffice';

async function signedIn() {
  const t = await signinOffice();
  const authId = await addSignIn(t, 'usr_002', { password: 'a good password' });
  const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
  const deps = await signinDepsOf(t);
  const first = await passwordSignIn(deps, { email, password: 'a good password', address: '203.0.113.7' });
  return { t, authId, email, deps, first, sessionId: String(decodeJwt(first.access_token).session_id) };
}

const reasonOf = (work: Promise<unknown>) => work.then(() => 'passed', (error: { details?: { reason?: string } }) => error.details?.reason ?? 'no reason');

describe('the sessions of the own stack (server/auth/own/sessions.ts)', () => {
  it('rotates the refresh token: the new one works, and the session stays the same', async () => {
    const { deps, first, sessionId } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(second.access_token).session_id).toBe(sessionId);
    expect(await refreshSignIn(deps, { refreshToken: bareToken(second.refresh_token) })).toMatchObject({ token_type: 'bearer' });
  });

  it('a refresh with the bare secret rotates the session and gives a tagged token again', async () => {
    const { deps, first } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    expect(second.refresh_token).toBe(`${deps.ent}.${second.refresh_token.split('.')[1]}`);
    expect(decodeJwt(second.access_token).ent).toBe(deps.ent);
  });

  it('a second use of the old refresh token within the reuse window rotates again, and signs nobody out', async () => {
    const { t, deps, first } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    t.deps.clock.advance(5_000);
    const again = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    expect(again.refresh_token).not.toBe(second.refresh_token);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(again.refresh_token) }))).toBe('passed');
  });

  it('a retry 30 seconds after a lost answer keeps the session (review 2026-11-10, finding 5)', async () => {
    const { t, deps, first, sessionId } = await signedIn();
    // The answer of this refresh is lost on the network: the browser still holds the first token.
    await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    t.deps.clock.advance(30_000);
    expect(await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) })).toMatchObject({ token_type: 'bearer' });
    expect(t.raw.prepare('select revoked_at from auth_sessions where id = ?').get(sessionId)).toEqual({ revoked_at: null });
  });

  it('a use of an old refresh token after 60 s ends the whole session', async () => {
    // Review 2026-11-10 (owner): the reuse window is 60 s, not 10 s, so the clock moves 61 s.
    const { t, deps, first, sessionId } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    t.deps.clock.advance(61_000);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) }))).toBe('session_ended');
    expect(t.raw.prepare('select revoked_at is not null as gone from auth_sessions where id = ?').get(sessionId)).toEqual({ gone: 1 });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(second.refresh_token) }))).toBe('session_ended');
  });

  it('an agent session keeps the 10 s window: the previous token 30 s after a rotation ends the session, 5 s rotates again (task D5b)', async () => {
    const { t, authId, deps } = await signedIn();
    const agent = (id: string) => t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values (?, ?, 'c-agent', 'oauth', ?, '2026-11-17T06:00:00.000Z')").run(id, authId, `${id}-h1`);
    const gone = (id: string) => t.raw.prepare('select revoked_at is not null as gone from auth_sessions where id = ?').get(id);
    agent('s-late');
    await rotateSession(deps, { hash: 's-late-h1', nextHash: 's-late-h2', clientId: 'c-agent' });
    t.deps.clock.advance(30_000);
    expect(await reasonOf(rotateSession(deps, { hash: 's-late-h1', nextHash: 's-late-h3', clientId: 'c-agent' }))).toBe('session_ended');
    expect(gone('s-late')).toEqual({ gone: 1 });
    agent('s-soon');
    await rotateSession(deps, { hash: 's-soon-h1', nextHash: 's-soon-h2', clientId: 'c-agent' });
    t.deps.clock.advance(5_000);
    expect(await rotateSession(deps, { hash: 's-soon-h1', nextHash: 's-soon-h3', clientId: 'c-agent' })).toMatchObject({ id: 's-soon' });
    expect(gone('s-soon')).toEqual({ gone: 0 });
  });

  it('a displaced token ends the session of a thief (review 2026-11-10, open item)', async () => {
    const { t, deps, first, sessionId } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    // The thief holds a copy of the first token and uses it inside the reuse window.
    t.deps.clock.advance(5_000);
    const third = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    const fourth = await refreshSignIn(deps, { refreshToken: bareToken(third.refresh_token) });
    // The token of the person (second) is now neither the current hash nor the previous hash of the session.
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(second.refresh_token) }))).toBe('session_ended');
    expect(t.raw.prepare('select revoked_at is not null as gone from auth_sessions where id = ?').get(sessionId)).toEqual({ gone: 1 });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(fourth.refresh_token) }))).toBe('session_ended');
  });

  it('a displaced hash of an ended session gives the plain answer', async () => {
    const { t, deps, first, sessionId } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    t.deps.clock.advance(5_000);
    const third = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    await refreshSignIn(deps, { refreshToken: bareToken(third.refresh_token) });
    t.raw.prepare("update auth_sessions set revoked_at = '2026-10-17T06:00:01.000Z' where id = ?").run(sessionId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(second.refresh_token) }))).toBe('session_ended');
    expect(t.raw.prepare('select revoked_at from auth_sessions where id = ?').get(sessionId)).toEqual({ revoked_at: '2026-10-17T06:00:01.000Z' });
  });

  it('an unknown token ends nothing', async () => {
    const { t, deps } = await signedIn();
    const rows = () => t.raw.prepare('select * from auth_sessions order by id').all();
    const before = rows();
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: 'a token that no session ever held' }))).toBe('session_ended');
    expect(rows()).toEqual(before);
  });

  it('a displaced token ends an agent session too (the OAuth refresh, inside the 10 s window)', async () => {
    const { t, authId, deps } = await signedIn();
    const { sha256Hex } = await import('./crypto');
    t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-agent', ?, 'c-agent', 'oauth', ?, '2026-11-17T06:00:00.000Z')").run(authId, await sha256Hex('agent-t1'));
    const refresh = (token: string) => exchangeToken(deps, { form: { grant_type: 'refresh_token', refresh_token: token, client_id: 'c-agent' } });
    const codeOf = (work: Promise<unknown>) => work.then(() => 'passed', (error: { code?: string }) => error.code ?? 'no code');
    const second = await refresh('agent-t1');
    t.deps.clock.advance(5_000);
    const third = await refresh('agent-t1');
    const fourth = await refresh(third.refresh_token);
    expect(await codeOf(refresh(second.refresh_token))).toBe('invalid_grant');
    expect(t.raw.prepare("select revoked_at is not null as gone from auth_sessions where id = 's-agent'").get()).toEqual({ gone: 1 });
    expect(await codeOf(refresh(fourth.refresh_token))).toBe('invalid_grant');
  });

  it('refuses the refresh of a turned-off person, and of a banned one', async () => {
    const { t, authId, deps, first } = await signedIn();
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    t.raw.prepare('update auth_sessions set revoked_at = null').run();
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) }))).toBe('account_off');
    t.raw.prepare('update auth_users set banned = 1 where id = ?').run(authId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) }))).toBe('session_ended');
  });

  it('refuses an unknown token, an ended session and the refresh token of an agent session', async () => {
    const { t, authId, deps } = await signedIn();
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: 'nothing' }))).toBe('session_ended');
    const { sha256Hex } = await import('./crypto');
    t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-agent', ?, 'c1', 'oauth', ?, '2026-11-17T06:00:00.000Z')").run(authId, await sha256Hex('agent-refresh'));
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: 'agent-refresh' }))).toBe('session_ended');
  });

  it('keeps a session 30 days after its last refresh', async () => {
    const { t, deps, first, sessionId } = await signedIn();
    t.deps.clock.advance(29 * 24 * 60 * 60 * 1000);
    const later = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    expect(t.raw.prepare('select expires_at from auth_sessions where id = ?').get(sessionId)).toEqual({ expires_at: '2026-12-15T06:00:00.000Z' });
    t.deps.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(later.refresh_token) }))).toBe('session_ended');
  });

  it('signs out this device only, or every other device and agent', async () => {
    const { t, authId, email, deps, first, sessionId } = await signedIn();
    const phone = await passwordSignIn(deps, { email, password: 'a good password', address: '203.0.113.8' });
    t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-agent', ?, 'c1', 'oauth', 'h', '2026-11-17T06:00:00.000Z')").run(authId);
    await signOutSessions(deps, { authId, sessionId, scope: 'others' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(phone.refresh_token) }))).toBe('session_ended');
    expect(t.raw.prepare("select revoked_at is not null as gone from auth_sessions where id = 's-agent'").get()).toEqual({ gone: 1 });
    const next = await refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) });
    await signOutSessions(deps, { authId, sessionId, scope: 'local' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(next.refresh_token) }))).toBe('session_ended');
  });

  it('never ends the session of another person', async () => {
    const { t, deps, first } = await signedIn();
    const other = await addSignIn(t, 'usr_003', { password: 'another password' });
    const sessionOfFirst = String(decodeJwt(first.access_token).session_id);
    await signOutSessions(deps, { authId: other, sessionId: sessionOfFirst, scope: 'local' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: bareToken(first.refresh_token) }))).toBe('passed');
  });
});
