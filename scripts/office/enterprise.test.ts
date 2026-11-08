import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { EnterpriseRowShape } from '../../server/enterprise/shapes';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { FAKE_ENTERPRISE, fakeEnterpriseSource, registerEnterprise, SAMPLE_ENTERPRISE } from './enterprise';
import { seedSource } from './seed';

const NOW = new Date('2026-10-04T06:00:00Z');
const titleOf = (source: Awaited<ReturnType<typeof fakeEnterpriseSource>>, table: string, id: string) =>
  source.tables.find((t) => t.table === table)!.rows.find((r) => r.id === id)!.doc;

describe('the two enterprises of the local stack (scripts/office/enterprise.ts)', () => {
  it('FAKE_ENTERPRISE and SAMPLE_ENTERPRISE pass the EnterpriseRow rules (id, address, reserved words)', () => {
    expect(EnterpriseRowShape.safeParse(FAKE_ENTERPRISE).success).toBe(true);
    expect(EnterpriseRowShape.safeParse(SAMPLE_ENTERPRISE).success).toBe(true);
    expect([SAMPLE_ENTERPRISE.id, SAMPLE_ENTERPRISE.address, FAKE_ENTERPRISE.id, FAKE_ENTERPRISE.address]).toEqual(['ent_001', 'vados', 'ent_002', 'globex']);
    expect(EnterpriseRowShape.safeParse({ ...FAKE_ENTERPRISE, address: 'oauth' }).success).toBe(false);
  });

  it('fakeEnterpriseSource has usr_001, usr_002, prj_001 and tsk_001, and no email of the sample office', async () => {
    const fake = await fakeEnterpriseSource({ now: NOW, passwords: localPasswords() });
    const ids = (table: string) => fake.tables.find((t) => t.table === table)!.rows.map((r) => r.id);
    expect(ids('users')).toEqual(['usr_001', 'usr_002']);
    expect(ids('projects')).toEqual(['prj_001']);
    expect(ids('tasks')).toEqual(['tsk_001']);
    const sample = await seedSource({ now: NOW, passwords: localPasswords() });
    const sampleEmails = new Set(sample.source.tables.find((t) => t.table === 'users')!.rows.map((r) => String(r.doc.email)));
    for (const row of fake.tables.find((t) => t.table === 'users')!.rows) {
      expect(String(row.doc.email)).toMatch(/@globex\.test$/);
      expect(sampleEmails.has(String(row.doc.email))).toBe(false);
    }
    expect(fake.signin.map((s) => [s.email, s.user_id])).toEqual([['admin@globex.test', 'usr_001'], ['member@globex.test', 'usr_002']]);
    for (const row of fake.signin) expect(row.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    for (const row of sample.source.signin) expect(fake.signin.map((s) => s.email)).not.toContain(row.email);
    expect(fake.signin.map((s) => s.id)).not.toEqual(expect.arrayContaining(sample.source.signin.map((s) => s.id)));
  });

  it('fakeEnterpriseSource has the same record ids as the sample office with other names', async () => {
    const fake = await fakeEnterpriseSource({ now: NOW, passwords: localPasswords() });
    const sample = await buildSeed('2026-10-04', async () => undefined);
    expect(sample.projects.prj_001).toBeDefined();
    expect(sample.tasks.tsk_001).toBeDefined();
    expect(sample.users.usr_001).toBeDefined();
    expect(titleOf(fake, 'projects', 'prj_001').name).toBe('Globex Tower');
    expect(titleOf(fake, 'projects', 'prj_001').name).not.toBe(sample.projects.prj_001.name);
    expect(titleOf(fake, 'tasks', 'tsk_001').title).not.toBe(sample.tasks.tsk_001.title);
    expect(titleOf(fake, 'users', 'usr_001').name).not.toBe(sample.users.usr_001.name);
  });

  it('refuses a short password and names the secret, never the value', async () => {
    const passwords = { ...localPasswords(), MADAR_TEST_PASSWORD_ADMIN: 'short' };
    await expect(fakeEnterpriseSource({ now: NOW, passwords })).rejects.toThrow('MADAR_TEST_PASSWORD_ADMIN must hold at least 8 characters');
    await expect(fakeEnterpriseSource({ now: NOW, passwords })).rejects.not.toThrow('short');
  });

  it('registerEnterprise posts the ops secret in the header only', async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const send = (async (url: string, init: RequestInit) => (seen.push({ url, headers: new Headers(init.headers), body: String(init.body) }), new Response('{"ok":true}'))) as unknown as typeof fetch;
    await registerEnterprise('http://127.0.0.1:8792', 'the-ops-secret', { row: FAKE_ENTERPRISE, emails: ['admin@globex.test'] }, send);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('http://127.0.0.1:8792/api/office/platform-register');
    expect(seen[0].headers.get('x-madar-ops-secret')).toBe('the-ops-secret');
    expect(seen[0].body).not.toContain('the-ops-secret');
    expect(JSON.parse(seen[0].body)).toEqual({ row: FAKE_ENTERPRISE, emails: ['admin@globex.test'] });
    const failing = (async () => new Response('refused', { status: 401 })) as unknown as typeof fetch;
    await expect(registerEnterprise('http://127.0.0.1:8792', 'the-ops-secret', { row: FAKE_ENTERPRISE, emails: [] }, failing)).rejects.toThrow('answered 401');
    await expect(registerEnterprise('http://127.0.0.1:8792', 'the-ops-secret', { row: FAKE_ENTERPRISE, emails: [] }, failing)).rejects.not.toThrow('the-ops-secret');
  });
});
