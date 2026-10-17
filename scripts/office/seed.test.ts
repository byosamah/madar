import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { verifyPassword } from '../../server/auth/own/password';
import { httpOf, nodeOffice } from '../../server/office/test/nodeOffice';
import { DEPLOY_ACCOUNTS } from '../../tests/e2e-deploy/accounts';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { importOffice } from './import';
import { partsOps } from './ops';
import { accountPasswordsOf, SEED_AUTH_IDS, seedSource, withDueToday } from './seed';

const NOW = new Date('2026-10-04T06:00:00Z');

describe('the test seed into the office object (scripts/office/seed.ts)', () => {
  it('gives the test office with the role emails, and one sign-in row for each of the 4 accounts with a PBKDF2 hash', async () => {
    const { source } = await seedSource({ now: NOW, passwords: localPasswords() });
    const users = source.tables.find((t) => t.table === 'users')!;
    expect(users.rows.find((r) => r.id === 'usr_001')!.doc.email).toBe(DEPLOY_ACCOUNTS.admin.email);
    expect(source.signin.map((s) => [s.id, s.email, s.user_id])).toEqual(
      Object.values(DEPLOY_ACCOUNTS).map((a) => [SEED_AUTH_IDS[a.role], a.email, a.userId]),
    );
    const admin = source.signin.find((s) => s.user_id === 'usr_001')!;
    expect(admin.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect((await verifyPassword(localPasswords()[DEPLOY_ACCOUNTS.admin.passwordSecret], admin.password_hash)).ok).toBe(true);
  });

  it('gives each sample file a real object key and its upload', async () => {
    const { source, uploads } = await seedSource({ now: NOW, passwords: localPasswords() });
    const files = source.tables.find((t) => t.table === 'files')!;
    const keys = files.rows.flatMap((r) => ((r.doc.versions as { blobKey?: string }[]) ?? []).map((v) => v.blobKey));
    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads) expect(keys).toContain(upload.key);
  });

  it('refuses a password of less than 8 characters, and names the secret, not the value', async () => {
    const passwords = { ...localPasswords(), [DEPLOY_ACCOUNTS.member.passwordSecret]: 'short' };
    await expect(seedSource({ now: NOW, passwords })).rejects.toThrow(`${DEPLOY_ACCOUNTS.member.passwordSecret} must hold at least 8 characters`);
    await expect(seedSource({ now: NOW, passwords })).rejects.not.toThrow('short');
  });

  it('moves the due day of the first n open tasks with a lead to today, for the push measure of wave 5', async () => {
    type T = { dueDate: string | null; status: string; ownerId: string | null };
    const due = (source: Awaited<ReturnType<typeof seedSource>>['source']) => source.tables.find((t) => t.table === 'tasks')!.rows
      .map((r) => r.doc as T).filter((t) => t.dueDate === '2026-10-04' && t.status !== 'done' && t.ownerId !== null).length;
    const plain = await seedSource({ now: NOW, passwords: localPasswords() });
    const moved = await seedSource({ now: NOW, passwords: localPasswords(), dueToday: 5 });
    expect(due(moved.source)).toBeGreaterThan(due(plain.source));
    expect(due(moved.source)).toBeGreaterThanOrEqual(5);
    const tiny = { tasks: { a: { status: 'in_review', ownerId: 'usr_001', dueDate: null }, b: { status: 'done', ownerId: 'usr_001', dueDate: null } } } as unknown as State;
    expect(Object.values(withDueToday(tiny, 5, '2026-10-04').tasks).map((t) => t.dueDate)).toEqual(['2026-10-04', null]);
  });

  it('reads only the 4 password lines of secrets/test-accounts.env, and never a value into an error', () => {
    const text = '# the test accounts\nMADAR_TEST_PASSWORD_ADMIN=Admin-pass-1\nMADAR_TEST_PASSWORD_MEMBER="Member pass 2"\nOTHER=x\n';
    expect(accountPasswordsOf(text)).toEqual({ MADAR_TEST_PASSWORD_ADMIN: 'Admin-pass-1', MADAR_TEST_PASSWORD_MEMBER: 'Member pass 2' });
    expect(() => accountPasswordsOf('MADAR_TEST_PASSWORD_ADMIN=a\nMADAR_TEST_PASSWORD_ADMIN=b\n')).toThrow('MADAR_TEST_PASSWORD_ADMIN: the file sets it twice.');
  });

  it('replaces the office of a copy with the test tools on, so a person can sign in with the seed password', async () => {
    const t = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    const { source } = await seedSource({ now: NOW, passwords: localPasswords() });
    await importOffice(partsOps(t.parts), source, { mode: 'replace' });
    const answer = await t.route(httpOf('POST', '/api/auth/token', {
      grant_type: 'password', email: DEPLOY_ACCOUNTS.member.email, password: localPasswords()[DEPLOY_ACCOUNTS.member.passwordSecret],
    }));
    expect(answer.status).toBe(200);
    const wrong = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: DEPLOY_ACCOUNTS.member.email, password: 'not-the-seed-password' }));
    expect(wrong.status).not.toBe(200);
  });
});
