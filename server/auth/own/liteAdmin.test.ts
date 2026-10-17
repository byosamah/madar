import { describe, expect, it } from 'vitest';
import { freshLite } from '../../data/lite/testDb';
import { fixedClock } from '../../test/fakes/clock';
import { linkFor } from '../invite';
import { sha256Hex } from './crypto';
import { liteAuthAdmin } from './liteAdmin';
import { verifyPassword } from './password';

async function setup() {
  const { raw, db } = await freshLite();
  const clock = fixedClock('2026-10-17T06:00:00Z');
  return { raw, db, clock, admin: liteAuthAdmin({ db, clock }) };
}

describe('liteAuthAdmin (server/auth/own/liteAdmin.ts)', () => {
  it('makes the sign-in row and one link of 1 hour for an invitation, and keeps only the sha256 of the token', async () => {
    const { raw, admin } = await setup();
    const link = await admin.generateLink('invite', 'New.Person@Madar.test');
    expect(link.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(raw.prepare('select id, email, password_hash, email_confirmed from auth_users').all()).toEqual([{ id: link.authUserId, email: 'new.person@madar.test', password_hash: null, email_confirmed: 0 }]);
    expect(raw.prepare('select token_hash, type, expires_at, used_at from auth_links').all()).toEqual([
      { token_hash: await sha256Hex(link.tokenHash), type: 'invite', expires_at: '2026-10-17T07:00:00.000Z', used_at: null },
    ]);
    const everything = JSON.stringify(raw.prepare('select * from auth_links').all()) + JSON.stringify(raw.prepare('select * from auth_users').all());
    expect(everything).not.toContain(link.tokenHash);
  });

  it('ends the open links of the person when it makes a new one', async () => {
    const { raw, admin, clock } = await setup();
    await admin.generateLink('invite', 'p@madar.test');
    clock.advance(60_000);
    await admin.generateLink('invite', 'p@madar.test');
    expect(raw.prepare('select used_at from auth_links order by created_at').all()).toEqual([{ used_at: '2026-10-17T06:01:00.000Z' }, { used_at: null }]);
  });

  it('refuses an invite link for a confirmed email, as Supabase does, so linkFor sends a recovery link', async () => {
    const { raw, admin } = await setup();
    await admin.generateLink('invite', 'p@madar.test');
    raw.exec('update auth_users set email_confirmed = 1');
    await expect(admin.generateLink('invite', 'p@madar.test')).rejects.toMatchObject({ status: 422, code: 'email_exists' });
    expect((await linkFor(admin, 'p@madar.test')).type).toBe('recovery');
  });

  it('refuses a recovery link for an email with no sign-in row', async () => {
    const { raw, admin } = await setup();
    await expect(admin.generateLink('recovery', 'nobody@madar.test')).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
    expect(raw.prepare('select count(*) as n from auth_users').get()).toEqual({ n: 0 });
  });

  it('ends every session of a banned person, and an unban opens none again', async () => {
    const { raw, admin } = await setup();
    const { authUserId } = await admin.generateLink('invite', 'p@madar.test');
    raw.exec(`insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values ('s1', '${authUserId}', 'password', 'h1', '2026-11-17T06:00:00.000Z'), ('s2', '${authUserId}', 'oauth', 'h2', '2026-11-17T06:00:00.000Z')`);
    await admin.setBanned(authUserId, true);
    expect(raw.prepare('select banned from auth_users').get()).toEqual({ banned: 1 });
    expect(raw.prepare('select id, revoked_at from auth_sessions order by id').all()).toEqual([{ id: 's1', revoked_at: '2026-10-17T06:00:00.000Z' }, { id: 's2', revoked_at: '2026-10-17T06:00:00.000Z' }]);
    await admin.setBanned(authUserId, false);
    expect(raw.prepare('select banned from auth_users').get()).toEqual({ banned: 0 });
    expect(raw.prepare('select count(*) as n from auth_sessions where revoked_at is null').get()).toEqual({ n: 0 });
  });

  it('confirms a new email only when asked, and refuses an email of another sign-in row', async () => {
    const { admin } = await setup();
    const one = await admin.generateLink('invite', 'one@madar.test');
    await admin.generateLink('invite', 'two@madar.test');
    await admin.updateEmail(one.authUserId, 'One.New@madar.test');
    expect(await admin.getUser(one.authUserId)).toEqual({ authUserId: one.authUserId, email: 'one.new@madar.test', confirmed: false, passwordSet: false });
    await admin.updateEmail(one.authUserId, 'one.new@madar.test', { confirm: true });
    expect((await admin.getUser(one.authUserId))?.confirmed).toBe(true);
    await expect(admin.updateEmail(one.authUserId, 'two@madar.test')).rejects.toMatchObject({ status: 422, code: 'email_exists' });
  });

  it('lists every sign-in row for users.invites, and gives null for an unknown id', async () => {
    const { admin } = await setup();
    const one = await admin.generateLink('invite', 'one@madar.test');
    expect(await admin.listUsers()).toEqual([{ authUserId: one.authUserId, email: 'one@madar.test', confirmed: false, passwordSet: false }]);
    expect(await admin.getUser('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('makes a first Admin with a PBKDF2 password, confirmed and marked', async () => {
    const { raw, admin } = await setup();
    const { authUserId } = await admin.createUser('Admin@madar.test', 'a good password');
    const row = raw.prepare('select email, password_hash, password_set, email_confirmed from auth_users where id = ?').get(authUserId) as { password_hash: string };
    expect(row).toMatchObject({ email: 'admin@madar.test', password_set: 1, email_confirmed: 1 });
    expect(await verifyPassword('a good password', row.password_hash)).toEqual({ ok: true, upgrade: false });
    await expect(admin.createUser('admin@madar.test', 'x')).rejects.toMatchObject({ code: 'email_exists' });
  });
});
