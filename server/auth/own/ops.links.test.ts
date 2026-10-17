import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { passwordSignIn, setSignInPassword, verifySignInLink } from './ops';
import { addSignIn, linkValueOfMail, signinDepsOf, signinOffice, type TestOffice } from './testOffice';

const ADDRESS = '203.0.113.7';
const NEW_PERSON = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
const reasonOf = (work: Promise<unknown>) => work.then(() => 'passed', (error: { details?: { reason?: string } }) => error.details?.reason ?? 'no reason');

async function invitedPerson(t: TestOffice) {
  const userId = ((await t.call('usr_001', 'users.create', NEW_PERSON)) as { output: { id: string } }).output.id;
  return { userId, token: linkValueOfMail(t.deps.mail.sent.at(-1)!.html, 'token_hash') };
}

const sessionOf = (answer: { access_token: string }) => String(decodeJwt(answer.access_token).session_id);

describe('the Welcome and Reset steps of the own stack (server/auth/own/ops.ts)', () => {
  it('opens a link session once, confirms the email, and ends the other open links', async () => {
    const t = await signinOffice();
    const { userId, token } = await invitedPerson(t);
    const deps = await signinDepsOf(t);
    const answer = await verifySignInLink(deps, { token, type: 'invite', address: ADDRESS });
    expect(answer.token_type).toBe('bearer');
    expect(t.raw.prepare('select email_confirmed, user_id from auth_users').get()).toEqual({ email_confirmed: 1, user_id: userId });
    expect(t.raw.prepare('select amr, link_until from auth_sessions').get()).toEqual({ amr: 'link', link_until: '2026-10-17T07:00:00.000Z' });
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 0 });
  });

  it('refuses a used link, a link older than 1 hour, a link of the other type and a replaced link', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const { userId, token } = await invitedPerson(t);
    expect(await reasonOf(verifySignInLink(deps, { token, type: 'recovery', address: ADDRESS }))).toBe('link_ended');
    await verifySignInLink(deps, { token, type: 'invite', address: ADDRESS });
    expect(await reasonOf(verifySignInLink(deps, { token, type: 'invite', address: ADDRESS }))).toBe('link_ended');
    expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    const replaced = linkValueOfMail(t.deps.mail.sent.at(-1)!.html, 'token_hash');
    expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    expect(await reasonOf(verifySignInLink(deps, { token: replaced, type: 'recovery', address: ADDRESS }))).toBe('link_ended');
    const newest = linkValueOfMail(t.deps.mail.sent.at(-1)!.html, 'token_hash');
    t.deps.clock.advance(60 * 60 * 1000 + 1);
    expect(await reasonOf(verifySignInLink(deps, { token: newest, type: 'recovery', address: ADDRESS }))).toBe('link_ended');
    expect(t.raw.prepare('select count(*) as n from auth_sessions').get()).toEqual({ n: 1 });
  });

  it('refuses the link of a turned-off person, and keeps the link for later', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const { userId, token } = await invitedPerson(t);
    expect((await t.call('usr_001', 'users.deactivate', { id: userId })).ok).toBe(true);
    expect(await reasonOf(verifySignInLink(deps, { token, type: 'invite', address: ADDRESS }))).toBe('link_ended');
    expect(t.raw.prepare('select count(*) as n from auth_sessions').get()).toEqual({ n: 0 });
  });

  it('lets a link session set the first password once with no current password, and users.invites then says active', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const { userId, token } = await invitedPerson(t);
    const answer = await verifySignInLink(deps, { token, type: 'invite', address: ADDRESS });
    const authId = String(decodeJwt(answer.access_token).sub);
    expect(await setSignInPassword(deps, { authId, sessionId: sessionOf(answer), password: 'my new password' })).toEqual({ ok: true });
    const invites = (await t.call('usr_001', 'users.invites', {})) as { output: { userId: string; state: string }[] };
    expect(invites.output.find((row) => row.userId === userId)?.state).toBe('active');
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: sessionOf(answer), password: 'another new one' }))).toBe('current_password_required');
    expect(await passwordSignIn(deps, { email: NEW_PERSON.email, password: 'my new password', address: ADDRESS })).toMatchObject({ token_type: 'bearer' });
  });

  it('runs the reset flow: the forgot mail, the link, a new password; the old password stops', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const authId = await addSignIn(t, 'usr_002', { password: 'the old password' });
    const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
    const link = await t.deps.authAdmin.generateLink('recovery', email);
    const answer = await verifySignInLink(deps, { token: link.tokenHash, type: 'recovery', address: ADDRESS });
    await setSignInPassword(deps, { authId, sessionId: sessionOf(answer), password: 'the new password' });
    expect(await reasonOf(passwordSignIn(deps, { email, password: 'the old password', address: ADDRESS }))).toBe('invalid_credentials');
    expect(await reasonOf(passwordSignIn(deps, { email, password: 'the new password', address: ADDRESS }))).toBe('passed');
  });

  it('needs the right current password in a normal session, refuses a short one and the same one', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const authId = await addSignIn(t, 'usr_002', { password: 'the old password' });
    const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
    const session = sessionOf(await passwordSignIn(deps, { email, password: 'the old password', address: ADDRESS }));
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: session, password: 'the new password', current: 'wrong' }))).toBe('invalid_credentials');
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: session, password: 'short', current: 'the old password' }))).toBe('weak');
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: session, password: 'the old password', current: 'the old password' }))).toBe('same');
    expect(await setSignInPassword(deps, { authId, sessionId: session, password: 'the new password', current: 'the old password' })).toEqual({ ok: true });
  });

  it('refuses a session of another person and an ended session', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const mine = await addSignIn(t, 'usr_002', { password: 'the old password' });
    const theirs = await addSignIn(t, 'usr_003', { password: 'their password' });
    const email = (t.raw.prepare('select email from auth_users where id = ?').get(mine) as { email: string }).email;
    const session = sessionOf(await passwordSignIn(deps, { email, password: 'the old password', address: ADDRESS }));
    expect(await reasonOf(setSignInPassword(deps, { authId: theirs, sessionId: session, password: 'x'.repeat(12), current: 'their password' }))).toBe('session_ended');
    t.raw.prepare('update auth_sessions set revoked_at = ?').run('2026-10-17T06:00:00.000Z');
    expect(await reasonOf(setSignInPassword(deps, { authId: mine, sessionId: session, password: 'x'.repeat(12), current: 'the old password' }))).toBe('session_ended');
  });
});
