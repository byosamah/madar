import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { nodeHost } from '../../data/lite/host';
import { fixedClock } from '../../test/fakes/clock';
import { ENT_VADO } from '../ids';
import type { EnterpriseRow, EnterpriseStatus } from '../types';
import { NODE_OFFICE_ENV, nodeOffice } from '../../office/test/nodeOffice';
import { recordingNet } from '../../office/test/fakes';
import { platformParts } from './parts';
import { applyPlatformSchema, PLATFORM_SCHEMA_VERSION } from './schema';

const NOW = '2026-11-08T08:00:00.000Z';
const ADDRESS = '203.0.113.7';

async function platform(at = NOW) {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyPlatformSchema(host);
  const parts = platformParts({ host, read: (name) => NODE_OFFICE_ENV[name], clock: fixedClock(at) });
  return { raw, host, parts };
}

const row = (id: string, address: string, extra: Partial<EnterpriseRow> = {}): EnterpriseRow => ({
  id, address, name: `Name ${id}`, nameAr: `اسم ${id}`, state: 'active', limits: { people: null, storageBytes: null },
  createdAt: NOW, firstAdmin: { name: 'First', email: `first@${address}.test` }, ...extra,
});

const statusOf = (ent: string, name = '', nameAr = ''): EnterpriseStatus => ({
  ent, people: 3, invited: 1, storageBytes: 0, lastWriteAt: null, day: { requests: 1, rowsRead: 2, rowsWritten: 3, mails: 4 }, name, nameAr,
});

describe('the email directory', () => {
  it('resolves a known email, and gives null for an unknown one', async () => {
    const { parts } = await platform();
    await parts.reserveEmail({ ent: 'ent_002', email: 'hala@globex.test' });
    expect(await parts.resolveEmail({ email: 'hala@globex.test' })).toEqual({ ent: 'ent_002' });
    expect(await parts.resolveEmail({ email: 'nobody@globex.test' })).toBeNull();
    // The caller normalizes the email: the directory does not guess.
    expect(await parts.resolveEmail({ email: 'Hala@Globex.test' })).toBeNull();
  });

  it('reserveEmail: ok, ok again for the same enterprise, taken for another; releaseEmail frees it and a release by another enterprise does nothing', async () => {
    const { parts } = await platform();
    expect(await parts.reserveEmail({ ent: 'ent_001', email: 'a@x.test' })).toBe('ok');
    expect(await parts.reserveEmail({ ent: 'ent_001', email: 'a@x.test' })).toBe('ok');
    expect(await parts.reserveEmail({ ent: 'ent_002', email: 'a@x.test' })).toBe('taken');
    await parts.releaseEmail({ ent: 'ent_002', email: 'a@x.test' });
    expect(await parts.resolveEmail({ email: 'a@x.test' })).toEqual({ ent: 'ent_001' });
    await parts.releaseEmail({ ent: 'ent_001', email: 'a@x.test' });
    expect(await parts.resolveEmail({ email: 'a@x.test' })).toBeNull();
    expect(await parts.reserveEmail({ ent: 'ent_002', email: 'a@x.test' })).toBe('ok');
  });

  it('refuses an id that is no enterprise id', async () => {
    const { parts } = await platform();
    await expect(parts.reserveEmail({ ent: 'ENT_1', email: 'a@x.test' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('the list of enterprises', () => {
  it('listed and resolveAddress leave out a creating enterprise', async () => {
    const { parts } = await platform();
    await parts.register({ row: row('ent_001', 'vados'), emails: [] });
    await parts.register({ row: row('ent_002', 'globex', { state: 'paused' }), emails: [] });
    await parts.register({ row: row('ent_003', 'initech', { state: 'creating' }), emails: [] });
    expect(await parts.listed()).toEqual(['ent_001', 'ent_002']);
    expect(await parts.resolveAddress({ address: 'vados' })).toEqual({ ent: 'ent_001' });
    expect(await parts.resolveAddress({ address: 'globex' })).toEqual({ ent: 'ent_002' });
    expect(await parts.resolveAddress({ address: 'initech' })).toBeNull();
    expect(await parts.resolveAddress({ address: 'nope' })).toBeNull();
  });

  it('register upserts a row, reserves its emails, and throws conflict for an email of another enterprise', async () => {
    const { parts, raw } = await platform();
    await parts.register({ row: row('ent_001', 'vados'), emails: ['A@X.test', 'b@x.test'] });
    await parts.register({ row: row('ent_001', 'vados', { name: 'Renamed' }), emails: ['a@x.test'] });
    expect(raw.prepare('select name from enterprises where id = ?').get('ent_001')).toEqual({ name: 'Renamed' });
    expect(await parts.resolveEmail({ email: 'a@x.test' })).toEqual({ ent: 'ent_001' });
    await expect(parts.register({ row: row('ent_002', 'globex'), emails: ['c@x.test', 'b@x.test'] })).rejects.toMatchObject({ code: 'conflict' });
    // The conflict leaves no row and no email behind.
    expect(raw.prepare('select count(*) as n from enterprises').get()).toEqual({ n: 1 });
    expect(await parts.resolveEmail({ email: 'c@x.test' })).toBeNull();
  });

  it('register with keepExisting leaves the row as it is (state, limits, names) and still adds the missing emails', async () => {
    const { parts, raw } = await platform();
    await parts.register({ row: row('ent_001', 'vados'), emails: ['a@x.test'] });
    // The platform paused the enterprise and set a limit meanwhile. A second run of the move script must not undo that.
    await parts.register({ row: row('ent_001', 'vados', { state: 'paused', name: 'Paused name', limits: { people: 10, storageBytes: null } }), emails: [] });
    await parts.register({ row: row('ent_001', 'vados', { name: 'Script name' }), emails: ['a@x.test', 'B@x.test'], keepExisting: true });
    expect(raw.prepare('select state, name, limits from enterprises where id = ?').get('ent_001')).toEqual({ state: 'paused', name: 'Paused name', limits: JSON.stringify({ people: 10, storageBytes: null }) });
    expect(await parts.resolveEmail({ email: 'b@x.test' })).toEqual({ ent: 'ent_001' });
    // With no row yet, keepExisting writes the row.
    await parts.register({ row: row('ent_002', 'globex'), emails: [], keepExisting: true });
    expect(raw.prepare('select address from enterprises where id = ?').get('ent_002')).toEqual({ address: 'globex' });
    // An address that another enterprise holds is still refused, and an email of another enterprise is still a conflict.
    await expect(parts.register({ row: row('ent_003', 'vados'), emails: [], keepExisting: true })).rejects.toMatchObject({ details: { reason: 'address_taken' } });
    await expect(parts.register({ row: row('ent_001', 'vados'), emails: ['b@x.test'], keepExisting: true })).resolves.toBeUndefined();
    await parts.register({ row: row('ent_002', 'globex'), emails: ['c@x.test'] });
    await expect(parts.register({ row: row('ent_001', 'vados'), emails: ['c@x.test'], keepExisting: true })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('register refuses an address name that another enterprise holds', async () => {
    const { parts } = await platform();
    await parts.register({ row: row('ent_001', 'vados'), emails: [] });
    await expect(parts.register({ row: row('ent_002', 'vados'), emails: [] })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'address_taken' } });
  });
});

describe('the meter and the status', () => {
  it('has no owner list: the platform object offers no method for it (design D11)', async () => {
    const { parts } = await platform();
    for (const name of ['isOwner', 'setOwners', 'ownersOf']) expect(parts).not.toHaveProperty(name);
  });

  it('meter replaces the counts of (ent, day) and the account total sums two enterprises', async () => {
    const { parts, raw } = await platform();
    const counts = (n: number) => ({ requests: n, rowsRead: n * 10, rowsWritten: n * 100, mails: n });
    expect(await parts.meter({ ent: 'ent_001', day: '2026-11-08', counts: counts(1) })).toEqual({ allowed: true });
    await parts.meter({ ent: 'ent_001', day: '2026-11-08', counts: counts(3) });
    await parts.meter({ ent: 'ent_001', day: '2026-11-08', counts: counts(3) });
    await parts.meter({ ent: 'ent_002', day: '2026-11-08', counts: counts(2) });
    await parts.meter({ ent: 'ent_002', day: '2026-11-07', counts: counts(9) });
    expect(raw.prepare('select sum(requests) as r, sum(rows_read) as rr, sum(rows_written) as rw, sum(mails) as m from account_day where day = ?').get('2026-11-08'))
      .toEqual({ r: 5, rr: 50, rw: 500, m: 5 });
    await expect(parts.meter({ ent: 'ent_001', day: 'today', counts: counts(1) })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('report keeps the name when the new name is empty', async () => {
    const { parts, raw } = await platform();
    await parts.register({ row: row('ent_001', 'vados', { name: 'Old', nameAr: 'قديم' }), emails: [] });
    await parts.report(statusOf('ent_001', 'New', 'جديد'));
    expect(raw.prepare('select name, name_ar from enterprises').get()).toEqual({ name: 'New', name_ar: 'جديد' });
    await parts.report(statusOf('ent_001', '', ''));
    expect(raw.prepare('select name, name_ar from enterprises').get()).toEqual({ name: 'New', name_ar: 'جديد' });
    expect(raw.prepare('select count(*) as n from status').get()).toEqual({ n: 1 });
  });

  it('mailReserve keeps the places of the account with the Free limit, and stores a repeat of a ref once', async () => {
    const { parts, raw } = await platform();
    expect(await parts.mailReserve({ ent: 'ent_001', kind: 'signin', day: '2026-11-08', ref: 'ent_001:invite:inv_1' })).toBe('ok');
    expect(await parts.mailReserve({ ent: 'ent_001', kind: 'signin', day: '2026-11-08', ref: 'ent_001:invite:inv_1' })).toBe('ok');
    expect(raw.prepare('select count(*) as n from mail_pool').get()).toEqual({ n: 1 });
    // The share of ent_002 is 10 percent of 90 notice places: 9.
    for (let i = 1; i <= 9; i += 1) expect(await parts.mailReserve({ ent: 'ent_002', kind: 'notice', day: '2026-11-08', ref: `ent_002:n${i}` })).toBe('ok');
    expect(await parts.mailReserve({ ent: 'ent_002', kind: 'notice', day: '2026-11-08', ref: 'ent_002:n10' })).toBe('full');
    await expect(parts.mailReserve({ ent: 'ent_002', kind: 'notice', day: 'today', ref: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('hitAddress counts the network address of the steps before a token', () => {
  const LIMITS = { 'auth.password': 30, 'auth.verify': 20, forgot: 10, renew: 10 } as const;

  it('allows the limit of each step, then answers the time left in the window, and keeps one counter for each step and each address', async () => {
    const { parts } = await platform();
    for (const [step, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
      for (let i = 1; i <= limit; i += 1) expect(await parts.hitAddress({ step, address: ADDRESS }), `${step} ${i}`).toEqual({ ok: true });
      const over = await parts.hitAddress({ step, address: ADDRESS });
      expect(over, step).toMatchObject({ ok: false });
      expect((over as { retryAfterMs: number }).retryAfterMs, step).toBeGreaterThan(0);
      // Another address is not stopped.
      expect(await parts.hitAddress({ step, address: '203.0.113.99' }), step).toEqual({ ok: true });
    }
  });

  it('refuses a step that has no address limit', async () => {
    const { parts } = await platform();
    await expect(parts.hitAddress({ step: 'auth.refresh' as never, address: ADDRESS })).rejects.toThrow();
  });

  it('is the only count: the refuse steps with addressChecked count the email and the key, not the address', async () => {
    const { parts, raw } = await platform();
    await parts.refuseSignin({ signin: 'auth.password', input: { email: 'a@b.test', password: 'x', address: ADDRESS, addressChecked: true } });
    await parts.refuseSignin({ signin: 'auth.verify', input: { token: 'tok', type: 'invite', address: ADDRESS, addressChecked: true } });
    await parts.refuseMail({ route: 'forgot', body: '{"email":"a@b.test"}', address: ADDRESS, addressChecked: true });
    await parts.refuseMail({ route: 'renew', body: '{"key":"k"}', address: ADDRESS, addressChecked: true });
    const keys = (raw.prepare('select key from rate_limits').all() as { key: string }[]).map((one) => one.key.split(':').slice(0, 2).join(':'));
    // Review 2026-11-10: the password step also counts the email with the address (signin:pair); no key of the address alone.
    expect(keys.sort()).toEqual(['forgot:email', 'renew:key', 'signin:email', 'signin:pair']);
  });
});

describe('the refuse steps give the answer of the object', () => {
  // Review 2026-11-10 (owner): the 10 count the email and the address together, so every try comes from one address.
  const inputs = (_i: number) => ({ email: 'ghost@globex.test', password: 'a wrong password', address: '203.0.113.1' });

  it('refuseSignin password answers invalid_credentials and counts the limits like the object: the 11th try for one email answers too_many', async () => {
    const { parts } = await platform();
    const object = await nodeOffice();
    for (let i = 1; i <= 12; i += 1) {
      const platformAnswer = await parts.refuseSignin({ signin: 'auth.password', input: inputs(i) });
      const objectAnswer = await object.parts.signin({ ent: ENT_VADO, signin: 'auth.password', input: inputs(i) });
      expect(platformAnswer, `try ${i}`).toEqual(objectAnswer);
      if (i <= 10) expect(platformAnswer).toMatchObject({ ok: false, error: { details: { reason: 'invalid_credentials' } } });
      else expect(platformAnswer).toMatchObject({ ok: false, error: { details: { reason: 'too_many' } } });
    }
  });

  it('refuseSignin verify answers link_ended and refresh answers session_ended, like the object', async () => {
    const { parts } = await platform();
    const object = await nodeOffice();
    const verify = { token: 'not-a-link', type: 'invite', address: ADDRESS };
    expect(await parts.refuseSignin({ signin: 'auth.verify', input: verify })).toEqual(await object.parts.signin({ ent: ENT_VADO, signin: 'auth.verify', input: verify }));
    expect(await parts.refuseSignin({ signin: 'auth.verify', input: verify })).toMatchObject({ ok: false, error: { details: { reason: 'link_ended' } } });
    const refresh = { refreshToken: 'not-a-token' };
    expect(await parts.refuseSignin({ signin: 'auth.refresh', input: refresh })).toEqual(await object.parts.signin({ ent: ENT_VADO, signin: 'auth.refresh', input: refresh }));
    expect(await parts.refuseSignin({ signin: 'auth.refresh', input: refresh })).toMatchObject({ ok: false, error: { details: { reason: 'session_ended' } } });
  });

  it('refuseMail forgot answers 200 {"v":1,"ok":true} for a good email, 400 for a bad email, and the too-many answer after the limit, like the object', async () => {
    const { parts } = await platform();
    const object = await nodeOffice();
    const net = recordingNet();
    const send = (body: string) => ({ route: 'forgot' as const, body, address: ADDRESS });
    const good = JSON.stringify({ email: 'ghost@globex.test' });
    expect((await parts.refuseMail(send('{"email":"nope"}'))).status).toBe(400);
    expect((await parts.refuseMail(send('not json'))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const platformAnswer = await parts.refuseMail(send(good));
      const objectAnswer = await object.parts.mailRoute({ ent: ENT_VADO, ...send(good) }, net);
      expect(platformAnswer.status, `try ${i}`).toBe(objectAnswer.status);
      expect(platformAnswer.body, `try ${i}`).toBe(objectAnswer.body);
      statuses.push(platformAnswer.status);
    }
    expect(statuses[0]).toBe(200);
    expect(statuses.at(-1)).toBe(429);
    expect((await parts.refuseMail(send(good))).status).toBe(429);
    const first = await platform();
    expect(await first.parts.refuseMail(send(good))).toEqual({ status: 200, body: '{"v":1,"ok":true}' });
  });

  it('refuseMail renew answers like the object for any key and returns no work', async () => {
    const { parts } = await platform();
    const object = await nodeOffice();
    const send = { route: 'renew' as const, body: JSON.stringify({ key: 'a-key-that-no-row-holds' }), address: ADDRESS };
    const platformAnswer = await parts.refuseMail(send);
    const objectAnswer = await object.parts.mailRoute({ ent: ENT_VADO, ...send }, recordingNet());
    expect(platformAnswer).toEqual({ status: objectAnswer.status, body: objectAnswer.body });
    expect(platformAnswer).not.toHaveProperty('work');
    expect((await parts.refuseMail({ ...send, body: '{}' })).status).toBe(400);
  });
});

describe('the cleanup and the schema', () => {
  it('sweep deletes old rate limit rows only', async () => {
    const { parts, raw } = await platform();
    raw.exec("insert into rate_limits (key, window_start, count) values ('old', '2026-11-06T00:00:00.000Z', 1), ('fresh', '2026-11-08T07:00:00.000Z', 1)");
    await parts.register({ row: row('ent_001', 'vados'), emails: ['a@x.test'] });
    await parts.sweep({ at: NOW });
    expect(raw.prepare('select key from rate_limits').all()).toEqual([{ key: 'fresh' }]);
    expect(raw.prepare('select count(*) as n from enterprises').get()).toEqual({ n: 1 });
    expect(raw.prepare('select count(*) as n from emails').get()).toEqual({ n: 1 });
  });

  it('applyPlatformSchema twice is a no-op, and a newer schema is refused', async () => {
    const { raw, host } = await platform();
    expect(await applyPlatformSchema(host)).toEqual({ applied: false });
    raw.exec('update schema_version set version = 99');
    await expect(applyPlatformSchema(host)).rejects.toThrow('is version 99');
    raw.exec(`update schema_version set version = ${PLATFORM_SCHEMA_VERSION}`);
  });

  it('keeps empty copies of the four sign-in tables and no table of an office', async () => {
    const { raw } = await platform();
    const tables = (raw.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['account_day', 'auth_links', 'auth_sessions', 'auth_users', 'emails', 'enterprises', 'mail_pool', 'owners', 'platform_accounts', 'platform_sessions', 'rate_limits', 'schema_version', 'status']);
  });

  it('health names the schema', async () => {
    const { parts } = await platform();
    expect(await parts.health()).toEqual({ schema: PLATFORM_SCHEMA_VERSION });
  });
});
