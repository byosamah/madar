import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { passwordSignIn, refreshSignIn, signOutSessions } from './ops';
import { addSignIn, signinDepsOf, signinOffice } from './testOffice';

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
    const second = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(second.access_token).session_id).toBe(sessionId);
    expect(await refreshSignIn(deps, { refreshToken: second.refresh_token })).toMatchObject({ token_type: 'bearer' });
  });

  it('a second use of the old refresh token within 10 s rotates again, and signs nobody out', async () => {
    const { t, deps, first } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    t.deps.clock.advance(5_000);
    const again = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    expect(again.refresh_token).not.toBe(second.refresh_token);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: again.refresh_token }))).toBe('passed');
  });

  it('a use of an old refresh token after 10 s ends the whole session', async () => {
    const { t, deps, first } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    t.deps.clock.advance(11_000);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('session_ended');
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: second.refresh_token }))).toBe('session_ended');
  });

  it('refuses the refresh of a turned-off person, and of a banned one', async () => {
    const { t, authId, deps, first } = await signedIn();
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    t.raw.prepare('update auth_sessions set revoked_at = null').run();
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('account_off');
    t.raw.prepare('update auth_users set banned = 1 where id = ?').run(authId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('session_ended');
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
    const later = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    expect(t.raw.prepare('select expires_at from auth_sessions where id = ?').get(sessionId)).toEqual({ expires_at: '2026-12-15T06:00:00.000Z' });
    t.deps.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: later.refresh_token }))).toBe('session_ended');
  });

  it('signs out this device only, or every other device and agent', async () => {
    const { t, authId, email, deps, first, sessionId } = await signedIn();
    const phone = await passwordSignIn(deps, { email, password: 'a good password', address: '203.0.113.8' });
    t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-agent', ?, 'c1', 'oauth', 'h', '2026-11-17T06:00:00.000Z')").run(authId);
    await signOutSessions(deps, { authId, sessionId, scope: 'others' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: phone.refresh_token }))).toBe('session_ended');
    expect(t.raw.prepare("select revoked_at is not null as gone from auth_sessions where id = 's-agent'").get()).toEqual({ gone: 1 });
    const next = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    await signOutSessions(deps, { authId, sessionId, scope: 'local' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: next.refresh_token }))).toBe('session_ended');
  });

  it('never ends the session of another person', async () => {
    const { t, deps, first } = await signedIn();
    const other = await addSignIn(t, 'usr_003', { password: 'another password' });
    const sessionOfFirst = String(decodeJwt(first.access_token).session_id);
    await signOutSessions(deps, { authId: other, sessionId: sessionOfFirst, scope: 'local' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('passed');
  });
});
