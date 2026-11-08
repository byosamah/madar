import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { nodeHost } from '../../data/lite/host';
import { NODE_OFFICE_ENV } from '../../office/test/nodeOffice';
import { fixedClock } from '../../test/fakes/clock';
import type { EnterpriseRow, EnterpriseStatus } from '../types';
import { platformParts } from './parts';
import { applyPlatformSchema, PLATFORM_SCHEMA_VERSION } from './schema';
import type { CreateRowInput } from './stub';

const NOW = '2026-11-08T08:00:00.000Z';

async function platform() {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyPlatformSchema(host);
  const parts = platformParts({ host, read: (name) => NODE_OFFICE_ENV[name], clock: fixedClock(NOW) });
  await parts.register({
    row: { id: 'ent_001', address: 'vados', name: "VADOs' Companies", nameAr: 'شركات فادو', state: 'active', limits: { people: null, storageBytes: null }, createdAt: NOW, firstAdmin: { name: 'Osama', email: 'osama@vado.test' } } satisfies EnterpriseRow,
    emails: ['osama@vado.test'],
  });
  return { raw, parts };
}

const input = (o: Partial<CreateRowInput> = {}): CreateRowInput => ({
  name: 'Acme Co', nameAr: 'أكمي', address: 'acme-co', logo: null, limits: { people: 5, storageBytes: 1000 }, admin: { name: 'Sara', email: 'Sara@Acme.test' }, ...o,
});
const status = (ent: string, name = '', nameAr = ''): EnterpriseStatus => ({
  ent, people: 3, invited: 1, storageBytes: 1234, lastWriteAt: '2026-11-08T07:00:00.000Z', day: { requests: 1, rowsRead: 2, rowsWritten: 3, mails: 4 }, name, nameAr,
});

describe('create', () => {
  it('makes ent_002 in state creating, fresh, and reserves the Admin email', async () => {
    const { parts } = await platform();
    const out = await parts.create(input());
    expect(out).toMatchObject({ ok: true, fresh: true, row: { id: 'ent_002', state: 'creating', address: 'acme-co', firstAdmin: { name: 'Sara', email: 'sara@acme.test' } } });
    expect(await parts.resolveEmail({ email: 'sara@acme.test' })).toEqual({ ent: 'ent_002' });
  });

  it('returns the same row with fresh false for the same input again', async () => {
    const { parts } = await platform();
    await parts.create(input());
    expect(await parts.create(input())).toMatchObject({ ok: true, fresh: false, row: { id: 'ent_002' } });
    expect((await parts.list()).map((row) => row.id)).toEqual(['ent_001', 'ent_002']);
  });

  it('refuses the same address with another email as address_taken, and a repeat after activate too', async () => {
    const { parts } = await platform();
    await parts.create(input());
    expect(await parts.create(input({ admin: { name: 'Other', email: 'other@acme.test' } }))).toEqual({ ok: false, refused: 'address_taken' });
    await parts.activate({ ent: 'ent_002' });
    expect(await parts.create(input())).toEqual({ ok: false, refused: 'address_taken' });
  });

  it('refuses an email of another enterprise as email_taken and names no enterprise', async () => {
    const { parts } = await platform();
    const out = await parts.create(input({ address: 'initech', admin: { name: 'Osama', email: 'OSAMA@vado.test' } }));
    expect(out).toEqual({ ok: false, refused: 'email_taken' });
    expect(out).not.toHaveProperty('ent');
    expect(JSON.stringify(out)).not.toContain('ent_001');
    expect((await parts.list()).map((row) => row.id)).toEqual(['ent_001']);
  });

  it('takes the highest id plus one, and refuses an address that is reserved or badly formed', async () => {
    const { parts } = await platform();
    await parts.create(input());
    expect(await parts.create(input({ address: 'initech', admin: { name: 'I', email: 'i@initech.test' } }))).toMatchObject({ row: { id: 'ent_003' } });
    await expect(parts.create(input({ address: 'mcp', admin: { name: 'I', email: 'm@mcp.test' } }))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(parts.create(input({ address: 'Bad_Name', admin: { name: 'I', email: 'b@bad.test' } }))).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('the lists and the state', () => {
  it('listed leaves out a creating row until activate, and activeIds leaves out a paused one while listed keeps it', async () => {
    const { parts } = await platform();
    await parts.create(input());
    expect(await parts.listed()).toEqual(['ent_001']);
    await parts.activate({ ent: 'ent_002' });
    expect(await parts.listed()).toEqual(['ent_001', 'ent_002']);
    await parts.setState({ ent: 'ent_002', state: 'paused' });
    expect(await parts.listed()).toEqual(['ent_001', 'ent_002']);
    expect(await parts.activeIds()).toEqual(['ent_001']);
    await parts.setState({ ent: 'ent_002', state: 'paused' });
    await parts.setState({ ent: 'ent_002', state: 'active' });
    expect(await parts.activeIds()).toEqual(['ent_001', 'ent_002']);
  });

  it('refuses setState for a creating row with not_finished', async () => {
    const { parts } = await platform();
    await parts.create(input());
    await expect(parts.setState({ ent: 'ent_002', state: 'paused' })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'not_finished' } });
  });

  it('activate moves creating to active only: it does not wake a paused row', async () => {
    const { parts } = await platform();
    await parts.create(input());
    await parts.activate({ ent: 'ent_002' });
    await parts.setState({ ent: 'ent_002', state: 'paused' });
    await parts.activate({ ent: 'ent_002' });
    expect((await parts.getEnterprise({ ent: 'ent_002' }))?.state).toBe('paused');
  });

  it('list gives the first Admin and a null status before the first report, and the people and the storage after a report', async () => {
    const { parts } = await platform();
    await parts.create(input());
    const before = (await parts.list()).find((row) => row.id === 'ent_002')!;
    expect(before).toMatchObject({ firstAdmin: { name: 'Sara' }, status: null, logo: null, name: 'Acme Co' });
    await parts.report(status('ent_002'));
    const after = (await parts.getEnterprise({ ent: 'ent_002' }))!;
    expect(after.status).toMatchObject({ people: 3, invited: 1, storageBytes: 1234, lastWriteAt: '2026-11-08T07:00:00.000Z' });
    // An empty name in the report keeps the stored name; a name in the report wins.
    expect(after.name).toBe('Acme Co');
    await parts.report(status('ent_002', 'Acme Renamed', 'أكمي الجديدة'));
    expect(await parts.getEnterprise({ ent: 'ent_002' })).toMatchObject({ name: 'Acme Renamed', nameAr: 'أكمي الجديدة' });
  });

  it('getEnterprise gives null for an unknown id and refuses a bad id', async () => {
    const { parts } = await platform();
    expect(await parts.getEnterprise({ ent: 'ent_099' })).toBeNull();
    await expect(parts.getEnterprise({ ent: 'bad' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('update changes the name, the logo and the limits, and ownersOf lists the owner pairs', async () => {
    const { parts } = await platform();
    await parts.create(input());
    await parts.update({ ent: 'ent_002', patch: { name: 'New', nameAr: 'جديد', logo: 'data:image/png;base64,AAAA', limits: { people: 9, storageBytes: null } } });
    expect(await parts.getEnterprise({ ent: 'ent_002' })).toMatchObject({ name: 'New', nameAr: 'جديد', logo: 'data:image/png;base64,AAAA', limits: { people: 9, storageBytes: null } });
    await parts.update({ ent: 'ent_002', patch: { logo: null } });
    expect((await parts.getEnterprise({ ent: 'ent_002' }))?.logo).toBeNull();
    await parts.update({ ent: 'ent_002', patch: {} });
    await parts.setOwners({ owners: [{ ent: 'ent_001', userId: 'usr_001' }] });
    expect(await parts.ownersOf()).toEqual([{ ent: 'ent_001', userId: 'usr_001' }]);
  });
});

describe('schema version 2', () => {
  it('steps a version 1 platform object to the column logo', async () => {
    const raw = new DatabaseSync(':memory:');
    const host = nodeHost(raw);
    await applyPlatformSchema(host);
    raw.exec('alter table enterprises drop column logo');
    raw.exec('drop table mail_pool');
    raw.exec('drop table platform_sessions');
    raw.exec('drop table platform_accounts');
    raw.exec('update schema_version set version = 1');
    expect(await applyPlatformSchema(host)).toEqual({ applied: true, steps: [2, 3, 4] });
    expect((raw.prepare('select name from pragma_table_info(?)').all('enterprises') as { name: string }[]).map((r) => r.name)).toContain('logo');
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: PLATFORM_SCHEMA_VERSION });
  });
});

describe('schema version 3', () => {
  it('steps a version 2 platform object to the table mail_pool', async () => {
    const raw = new DatabaseSync(':memory:');
    const host = nodeHost(raw);
    await applyPlatformSchema(host);
    raw.exec('drop table mail_pool');
    raw.exec('drop table platform_sessions');
    raw.exec('drop table platform_accounts');
    raw.exec('update schema_version set version = 2');
    expect(await applyPlatformSchema(host)).toEqual({ applied: true, steps: [3, 4] });
    expect((raw.prepare('select name from pragma_table_info(?)').all('mail_pool') as { name: string }[]).map((r) => r.name)).toEqual(['day', 'ref', 'kind', 'ent']);
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: PLATFORM_SCHEMA_VERSION });
  });
});

describe('schema version 4', () => {
  it('steps a version 3 platform object to the platform accounts and their sessions, and keeps the old rows', async () => {
    const raw = new DatabaseSync(':memory:');
    const host = nodeHost(raw);
    await applyPlatformSchema(host);
    raw.exec("insert into emails (email, ent) values ('a@x.test', 'ent_001')");
    raw.exec('drop table platform_sessions');
    raw.exec('drop table platform_accounts');
    raw.exec('update schema_version set version = 3');
    expect(await applyPlatformSchema(host)).toEqual({ applied: true, steps: [4] });
    expect((raw.prepare('select name from pragma_table_info(?)').all('platform_accounts') as { name: string }[]).map((r) => r.name)).toEqual(['id', 'email', 'name', 'password_hash', 'state', 'created_at']);
    expect((raw.prepare('select name from pragma_table_info(?)').all('platform_sessions') as { name: string }[]).map((r) => r.name)).toEqual(['id', 'account_id', 'refresh_hash', 'prev_hash', 'used_at', 'ends_at', 'created_at']);
    expect(raw.prepare('select email from emails').get()).toEqual({ email: 'a@x.test' });
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: PLATFORM_SCHEMA_VERSION });
  });
});
