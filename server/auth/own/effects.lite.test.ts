import { describe, expect, it } from 'vitest';
import { readLiteOffice } from '../../data/lite/office';
import { userIdOfAuth } from '../../data/officeCache';
import { addSignIn, linkValueOfMail, signinOffice } from './testOffice';

const NEW_PERSON = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
const tokenOfMail = (html: string) => linkValueOfMail(html, 'token_hash');

describe('the auth effects on SQLite (Supabase exit, wave 2)', () => {
  it('users.create sends the invitation, makes the sign-in row and links the person', async () => {
    const t = await signinOffice();
    const made = await t.call('usr_001', 'users.create', NEW_PERSON);
    expect(made.ok).toBe(true);
    const userId = (made as { output: { id: string } }).output.id;
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual(['new.person@madar.test']);
    const token = tokenOfMail(t.deps.mail.sent[0].html);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = t.raw.prepare('select id, user_id, email_confirmed from auth_users').all() as { id: string; user_id: string; email_confirmed: number }[];
    expect(row).toMatchObject({ user_id: userId, email_confirmed: 0 });
    expect(userIdOfAuth(await t.db.tx('read', (q) => readLiteOffice(t.db, q)), row.id)).toBe(userId);
    expect(t.raw.prepare("select count(*) as n from outbox where kind = 'auth.invite' and done_at is not null").get()).toEqual({ n: 1 });
    expect(t.raw.prepare('select kind from mail_log').all()).toEqual([{ kind: 'signin' }]);
    // The sent row keeps no live link token (security fix 8).
    expect(JSON.stringify(t.raw.prepare('select payload from outbox').all())).not.toContain(token);
  });

  it('users.deactivate bans the sign-in row and ends its sessions; users.reactivate lifts the ban', async () => {
    const t = await signinOffice();
    const authId = await addSignIn(t, 'usr_007', { password: 'a good password' });
    t.raw.prepare("insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values ('s1', ?, 'password', 'h1', '2026-11-17T06:00:00.000Z')").run(authId);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_007' })).ok).toBe(true);
    expect(t.raw.prepare('select banned from auth_users where id = ?').get(authId)).toEqual({ banned: 1 });
    expect(t.raw.prepare('select revoked_at from auth_sessions').get()).toEqual({ revoked_at: '2026-10-17T06:00:00.000Z' });
    expect((await t.call('usr_001', 'users.reactivate', { id: 'usr_007' })).ok).toBe(true);
    expect(t.raw.prepare('select banned from auth_users where id = ?').get(authId)).toEqual({ banned: 0 });
  });

  it('an email change before the person accepts moves the sign-in row and sends a new invitation to the new email', async () => {
    const t = await signinOffice();
    const userId = ((await t.call('usr_001', 'users.create', NEW_PERSON)) as { output: { id: string } }).output.id;
    expect((await t.call('usr_001', 'users.update', { id: userId, patch: { email: 'new.email@madar.test' } })).ok).toBe(true);
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual(['new.person@madar.test', 'new.email@madar.test']);
    expect(t.raw.prepare('select email, email_confirmed from auth_users').get()).toEqual({ email: 'new.email@madar.test', email_confirmed: 0 });
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
  });

  it('an email change after the person accepts sends a notice with no link to the old email', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_003', { password: 'a good password' });
    const old = (await t.db.tx('read', (q) => readLiteOffice(t.db, q))).lists.users.usr_003.email;
    expect((await t.call('usr_001', 'users.update', { id: 'usr_003', patch: { email: 'usr003.new@madar.test' } })).ok).toBe(true);
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual([old]);
    expect(t.deps.mail.sent[0].html).not.toContain('token_hash');
    expect(t.raw.prepare('select email, email_confirmed from auth_users where user_id = ?').get('usr_003')).toEqual({ email: 'usr003.new@madar.test', email_confirmed: 1 });
  });

  it('a full mail day keeps the invitation in the outbox until the next UTC day and makes no link', async () => {
    const t = await signinOffice();
    for (let i = 0; i < 98; i += 1) t.raw.prepare("insert into mail_log (utc_day, kind, ref) values ('2026-10-17', 'signin', ?)").run(`full-${i}`);
    expect((await t.call('usr_001', 'users.create', NEW_PERSON)).ok).toBe(true);
    expect(t.deps.mail.sent).toHaveLength(0);
    expect(t.raw.prepare('select count(*) as n from auth_links').get()).toEqual({ n: 0 });
    expect(t.raw.prepare("select claimed_until, attempts from outbox where kind = 'auth.invite'").get()).toEqual({ claimed_until: '2026-10-18T00:00:00.000Z', attempts: 0 });
  });

  it('sends no change signal for a sign-in row: the rows are not part of the State', async () => {
    const t = await signinOffice();
    await t.call('usr_001', 'users.create', NEW_PERSON);
    expect(JSON.stringify(t.deps.signal.sent)).not.toContain('auth_');
  });
});
