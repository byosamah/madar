import { describe, expect, it } from 'vitest';
import { addSignIn, signinOffice, type TestOffice } from '../auth/own/testOffice';

const NEW_PERSON = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
type InviteRow = { userId: string; state: 'active' | 'invited'; sentAt: string | null };

async function invited(t: TestOffice): Promise<string> {
  return ((await t.call('usr_001', 'users.create', NEW_PERSON)) as { output: { id: string } }).output.id;
}
async function stateOf(t: TestOffice, userId: string): Promise<InviteRow | undefined> {
  return ((await t.call('usr_001', 'users.invites', {})) as { output: InviteRow[] }).output.find((row) => row.userId === userId);
}

describe('users.invites and users.resendInvite on SQLite (Supabase exit, wave 2)', () => {
  it('says invited until the person opens the link and saves a password, then active', async () => {
    const t = await signinOffice();
    const userId = await invited(t);
    expect(await stateOf(t, userId)).toEqual({ userId, state: 'invited', sentAt: expect.any(String) });
    t.raw.prepare('update auth_users set email_confirmed = 1 where user_id = ?').run(userId);
    // Opened the link but saved no password: still invited (owner, 2026-10-04).
    expect((await stateOf(t, userId))?.state).toBe('invited');
    t.raw.prepare('update auth_users set password_set = 1 where user_id = ?').run(userId);
    expect((await stateOf(t, userId))?.state).toBe('active');
  });

  it('says invited with no date for a person who never got a sign-in row', async () => {
    const t = await signinOffice();
    expect(await stateOf(t, 'usr_004')).toEqual({ userId: 'usr_004', state: 'invited', sentAt: null });
  });

  it('sends the invitation again: the first link ends and one new link is open', async () => {
    const t = await signinOffice();
    const userId = await invited(t);
    t.deps.clock.advance(60_000);
    expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    expect(t.deps.mail.sent).toHaveLength(2);
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
  });

  it('stops at 5 resends a day for one person', async () => {
    const t = await signinOffice();
    const userId = await invited(t);
    for (let i = 0; i < 5; i += 1) expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    expect(await t.call('usr_001', 'users.resendInvite', { id: userId })).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'invite_limit' } } });
  });

  it('gives a member forbidden, and no answer holds a sign-in id', async () => {
    const t = await signinOffice();
    const authId = await addSignIn(t, 'usr_003', { password: 'a good password' });
    const member = await t.call('usr_005', 'users.invites', {});
    expect(member).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const admin = await t.call('usr_001', 'users.invites', {});
    expect(JSON.stringify(member) + JSON.stringify(admin)).not.toContain(authId);
    expect(await t.call('usr_005', 'users.resendInvite', { id: 'usr_003' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
