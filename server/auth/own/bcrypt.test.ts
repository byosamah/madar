import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { readLiteOffice } from '../../data/lite/office';
import { userIdOfAuth } from '../../data/officeCache';
import { isBcryptHash, verifyBcrypt } from './bcrypt';
import { importSigninRows, SIGNIN_EXPORT_SQL, type SigninExportRow } from './import';
import { passwordSignIn } from './ops';
import { verifyPassword } from './password';
import { signinDepsOf, signinOffice } from './testOffice';

const AUTH_ID = '11111111-1111-4111-8111-111111111111';
const GONE_ID = '22222222-2222-4222-8222-222222222222';
const COPIED = bcrypt.hashSync('a copied password', 10);
const row = (more: Partial<SigninExportRow> = {}): SigninExportRow => ({
  id: AUTH_ID, email: 'Copied@Madar.test', password_hash: COPIED, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002', ...more,
});

describe('the copied Supabase password (owner decision 4)', () => {
  it('knows the bcrypt form, the $2a$ of Supabase too, and checks it', () => {
    expect(isBcryptHash(COPIED)).toBe(true);
    // The hash of the wave 0 probe, as Supabase Auth makes it (scripts/proof/do-socket/public-inputs.json).
    expect(isBcryptHash('$2a$10$QyXrSV0ETPiKCL3760g9quRekv0QTzq.mEQMDpYVsBVKRWmu3o5p2')).toBe(true);
    expect(isBcryptHash('pbkdf2-sha256$100000$a$b')).toBe(false);
    expect(verifyBcrypt('a copied password', COPIED)).toBe(true);
    expect(verifyBcrypt('another one', COPIED)).toBe(false);
  });

  it('asks for a PBKDF2 hash in place of a bcrypt hash after the right password', async () => {
    expect(await verifyPassword('a copied password', COPIED)).toEqual({ ok: true, upgrade: true });
    expect(await verifyPassword('another one', COPIED)).toEqual({ ok: false, upgrade: false });
  });

  it('signs in with a copied bcrypt hash once and then holds a PBKDF2 hash', async () => {
    const t = await signinOffice();
    await t.db.tx('write', (q) => importSigninRows(q, [row()], t.deps.clock.now()));
    const deps = await signinDepsOf(t);
    const input = { email: 'copied@madar.test', password: 'a copied password', address: '203.0.113.7' };
    expect(await passwordSignIn(deps, input)).toMatchObject({ user: { id: AUTH_ID } });
    const { password_hash } = t.raw.prepare('select password_hash from auth_users where id = ?').get(AUTH_ID) as { password_hash: string };
    expect(password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await passwordSignIn(deps, input)).toMatchObject({ user: { id: AUTH_ID } });
  });

  it('keeps the link, the ban and the marks of the export, and drops a link to a person who is not in the office', async () => {
    const t = await signinOffice();
    const gone = row({ id: GONE_ID, email: 'gone@madar.test', user_id: 'usr_404', banned: true, password_set: false, email_confirmed: false, password_hash: null });
    expect(await t.db.tx('write', (q) => importSigninRows(q, [gone, row()], t.deps.clock.now()))).toBe(2);
    expect(t.raw.prepare('select id, user_id, email, password_hash is null as no_hash, banned, password_set, email_confirmed from auth_users order by id').all()).toEqual([
      { id: AUTH_ID, user_id: 'usr_002', email: 'copied@madar.test', no_hash: 0, banned: 0, password_set: 1, email_confirmed: 1 },
      { id: GONE_ID, user_id: null, email: 'gone@madar.test', no_hash: 1, banned: 1, password_set: 0, email_confirmed: 0 },
    ]);
    expect(userIdOfAuth(await t.db.tx('read', (q) => readLiteOffice(t.db, q)), AUTH_ID)).toBe('usr_002');
  });

  it('names in the export text each field of SigninExportRow, from auth.users, with no sort', () => {
    const names = [...SIGNIN_EXPORT_SQL.matchAll(/ as (\w+)/g)].map((match) => match[1]).sort();
    expect(names).toEqual(['banned', 'email', 'email_confirmed', 'id', 'password_hash', 'password_set', 'user_id']);
    expect(SIGNIN_EXPORT_SQL).toContain('from auth.users a');
    expect(SIGNIN_EXPORT_SQL).not.toContain('order by');
  });
});
