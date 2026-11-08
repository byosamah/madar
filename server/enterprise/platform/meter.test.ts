import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../../src/data/seed';
import { hashPassword } from '../../auth/own/password';
import { nodeHost } from '../../data/lite/host';
import { httpOf, NODE_TODAY, nodeWorld } from '../../office/test/nodeWorld';
import { NODE_OFFICE_ENV } from '../../office/test/nodeOffice';
import { fixedClock } from '../../test/fakes/clock';
import { PLATFORM_HANDLERS, type PlatformCtx } from './handlers';
import { platformParts } from './parts';
import { applyPlatformSchema } from './schema';

const DAY = '2026-11-08';
const counts = (o: Partial<{ requests: number; rowsRead: number; rowsWritten: number; mails: number }> = {}) => ({ requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0, ...o });

async function platform() {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyPlatformSchema(host);
  const parts = platformParts({ host, read: (name) => NODE_OFFICE_ENV[name], clock: fixedClock(`${DAY}T08:00:00Z`) });
  for (const [id, address] of [['ent_001', 'vados'], ['ent_002', 'globex']] as const) {
    await parts.register({
      row: { id, address, name: `Name ${id}`, nameAr: `اسم ${id}`, state: 'active', limits: { people: null, storageBytes: null }, createdAt: `${DAY}T00:00:00Z`, firstAdmin: { name: 'A', email: `a@${address}.test` } },
      emails: [],
    });
  }
  return { raw, parts };
}

describe('the meter of the platform object', () => {
  it('keeps the latest absolute counts of (ent, day): a repeat adds nothing', async () => {
    const { parts } = await platform();
    await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ requests: 10 }) });
    await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ requests: 25 }) });
    await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ requests: 25 }) });
    expect((await parts.meterToday({ day: DAY })).account.requests).toBe(25);
  });

  it('sums the account over all enterprises and lists each', async () => {
    const { parts } = await platform();
    await parts.meter({ ent: 'ent_001', day: DAY, counts: counts({ rowsRead: 100, mails: 2 }) });
    await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ rowsRead: 50, mails: 1 }) });
    await parts.meter({ ent: 'ent_002', day: '2026-11-07', counts: counts({ rowsRead: 9_000 }) });
    const today = await parts.meterToday({ day: DAY });
    expect(today.account).toEqual(counts({ rowsRead: 150, mails: 3 }));
    expect(today.byEnterprise.map((one) => one.ent)).toEqual(['ent_001', 'ent_002']);
  });

  it('capState is false at 89 percent and true at 90 percent of the rows read', async () => {
    const { parts } = await platform();
    await parts.meter({ ent: 'ent_001', day: DAY, counts: counts({ rowsRead: 4_499_999 }) });
    expect(await parts.capState({ day: DAY })).toEqual({ stop: false, writesStop: false });
    await parts.meter({ ent: 'ent_001', day: DAY, counts: counts({ rowsRead: 4_500_000, rowsWritten: 90_000 }) });
    expect(await parts.capState({ day: DAY })).toEqual({ stop: true, writesStop: true });
  });

  it('answers busy for ent_002 over its share and allowed for ent_001', async () => {
    const { parts } = await platform();
    expect(await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ requests: 9_999 }) })).toEqual({ allowed: true });
    expect(await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ requests: 10_000 }) })).toEqual({ allowed: false, reason: 'busy' });
    expect(await parts.meter({ ent: 'ent_001', day: DAY, counts: counts({ requests: 99_999 }) })).toEqual({ allowed: true });
  });
});

describe('platform.meter.get', () => {
  async function ctxOf() {
    const { parts } = await platform();
    const ctx = { ent: 'ent_001', userId: 'usr_001', platform: parts, office: () => ({}) as never, net: () => ({}) as never, read: (name: string) => NODE_OFFICE_ENV[name], now: () => new Date(`${DAY}T08:00:00Z`), log: { info() {}, warn() {}, error() {} } } as PlatformCtx;
    return { parts, ctx };
  }

  it('warns at 70,000 requests and stops at 90,000, with counts and names only', async () => {
    const { parts, ctx } = await ctxOf();
    await parts.meter({ ent: 'ent_001', day: DAY, counts: counts({ requests: 70_000 }) });
    expect(await PLATFORM_HANDLERS['platform.meter.get']({}, ctx)).toMatchObject({ day: DAY, warn: ['requests'], stop: false, share: 0.1, total: { requests: 70_000 }, limits: { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, mails: 100 } });
    await parts.meter({ ent: 'ent_002', day: DAY, counts: counts({ requests: 20_000 }) });
    const out = await PLATFORM_HANDLERS['platform.meter.get']({}, ctx);
    expect(out).toMatchObject({ stop: true });
    expect(out.enterprises.map((one) => [one.id, one.name, one.day.requests])).toEqual([['ent_001', 'Name ent_001', 70_000], ['ent_002', 'Name ent_002', 20_000]]);
    expect(Object.keys(out).sort()).toEqual(['day', 'enterprises', 'limits', 'share', 'stop', 'total', 'warn']);
  });
});

describe('the cap through the Worker and the object', () => {
  const PASSWORD = 'a good password';
  async function world() {
    const t = await nodeWorld({
      at: new Date().toISOString(), ents: ['ent_001', 'ent_002'], sleep: async () => undefined,
      seeds: { ent_001: await buildSeed(NODE_TODAY, async () => undefined), ent_002: await buildSeed(NODE_TODAY, async () => undefined) },
    });
    const hash = await hashPassword(PASSWORD);
    const row = (id: string, email: string) => ({ id, email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' });
    await t.signins([row('11111111-1111-4111-8111-111111111111', 'admin@one.test')], 'ent_001');
    await t.signins([row('22222222-2222-4222-8222-222222222222', 'admin@two.test')], 'ent_002');
    return t;
  }
  const signIn = async (t: Awaited<ReturnType<typeof world>>, email: string) => t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password: PASSWORD }));
  const batch = (t: Awaited<ReturnType<typeof world>>, token: string) => t.route(httpOf('POST', '/api/batch', { v: 1, calls: [{ i: 0, name: 'projects.list', input: {} }] }, { authorization: `Bearer ${token}` }));

  it('at the account stop: ent_002 gets busy on a batch and still signs in; ent_001 is never refused', async () => {
    const t = await world();
    const one = JSON.parse((await signIn(t, 'admin@one.test')).body).access_token as string;
    const two = JSON.parse((await signIn(t, 'admin@two.test')).body).access_token as string;
    await t.platform.meter({ ent: 'ent_001', day: new Date().toISOString().slice(0, 10), counts: counts({ rowsRead: 4_600_000 }) });
    const refused = await batch(t, two);
    expect(JSON.parse(refused.body).error).toMatchObject({ details: { reason: 'busy' }, message: 'Madar is busy today. It works again at 03:00 Riyadh.' });
    expect((await signIn(t, 'admin@two.test')).status).toBe(200);
    expect((await batch(t, one)).status).toBe(200);
  });

  it('at its share of requests: the object refuses a batch of ent_002 and lets the sign-in step run; ent_001 is never refused', async () => {
    const t = await world();
    const two = JSON.parse((await signIn(t, 'admin@two.test')).body).access_token as string;
    const one = JSON.parse((await signIn(t, 'admin@one.test')).body).access_token as string;
    for (const ent of ['ent_001', 'ent_002']) {
      const day = (t.clock.now() as Date).toISOString().slice(0, 10);
      t.ents.get(ent)!.raw.exec(`insert into usage_day (day, requests) values ('${day}', 10000) on conflict (day) do update set requests = 10000`);
    }
    const refused = await batch(t, two);
    expect(JSON.parse(refused.body).error).toMatchObject({ details: { reason: 'busy' }, message: 'Madar is busy for your company today. It works again at 03:00 Riyadh.' });
    expect((await signIn(t, 'admin@two.test')).status).toBe(200);
    expect((await batch(t, one)).status).toBe(200);
  });
});
