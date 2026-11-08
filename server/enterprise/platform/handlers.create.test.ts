import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { EnterpriseView } from '../../../src/api/contract/platform';
import type { OfficeStub } from '../../entries/officeWorker';
import { nodeHost } from '../../data/lite/host';
import { recordingNet } from '../../office/test/fakes';
import { NODE_OFFICE_ENV } from '../../office/test/nodeOffice';
import { fixedClock } from '../../test/fakes/clock';
import type { EnterpriseInit } from '../types';
import { createEnterprise, createOpen, type PlatformCtx } from './handlers';
import { platformParts } from './parts';
import { applyPlatformSchema } from './schema';
import type { PlatformStub } from './stub';

const NOW = '2026-11-08T08:00:00.000Z';
const input = (o: Record<string, unknown> = {}) => ({
  name: 'Acme Co', nameAr: 'أكمي', address: 'acme-co', logo: null, limits: { people: 5, storageBytes: 1024 },
  admin: { name: 'Sara', email: 'sara@acme.test', language: 'ar' as const }, ...o,
});

/** The real platform rows on node:sqlite, with a log of the calls, and a fake office object that keeps what init got. */
async function setup(env: Record<string, string> = { MADAR_ENTERPRISE_CREATE: 'open' }) {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyPlatformSchema(host);
  const real = platformParts({ host, read: (name) => NODE_OFFICE_ENV[name], clock: fixedClock(NOW) });
  await real.register({
    row: { id: 'ent_001', address: 'vados', name: 'VADO', nameAr: 'فادو', state: 'active', limits: { people: null, storageBytes: null }, createdAt: NOW, firstAdmin: { name: 'O', email: 'o@vado.test' } },
    emails: ['o@vado.test'],
  });
  const log: string[] = [];
  const platform = new Proxy(real, {
    get(target, key: string) {
      const value = (target as unknown as Record<string, unknown>)[key];
      if (key === 'create' || key === 'activate') return (...args: unknown[]) => (log.push(key), (value as (...a: unknown[]) => unknown).apply(target, args));
      return value;
    },
  }) as unknown as PlatformStub;
  const inits: EnterpriseInit[] = [];
  let invitations = 0;
  let failInit = false;
  const office = {
    init: async (init: EnterpriseInit) => {
      log.push('init');
      if (failInit) throw new Error('The object did not start.');
      inits.push(init);
      if (inits.length === 1) invitations += 1;
      return { ok: true as const, value: { adminUserId: 'usr_001' } };
    },
  } as unknown as OfficeStub;
  const ctx: PlatformCtx = {
    ent: 'ent_001', userId: 'usr_001', platform, office: () => office, net: () => recordingNet(), read: (name) => env[name] ?? NODE_OFFICE_ENV[name],
    now: () => new Date(NOW), log: { info() {}, warn() {}, error() {} },
  };
  return { ctx, log, inits, real, invitations: () => invitations, failInit: (on: boolean) => void (failInit = on) };
}

describe('createOpen', () => {
  it('is closed with no variable and no test tools, open with open, and open with the test tools', () => {
    expect(createOpen(() => undefined)).toBe(false);
    expect(createOpen((n) => ({ MADAR_ENTERPRISE_CREATE: 'closed' })[n])).toBe(false);
    expect(createOpen((n) => ({ MADAR_ENTERPRISE_CREATE: 'open' })[n])).toBe(true);
    expect(createOpen((n) => ({ MADAR_TEST_TOOLS: 'on', APP_URL: 'https://madar.test' })[n])).toBe(true);
  });
});

describe('platform.enterprises.create', () => {
  it('refuses with create_closed when it is closed, and writes nothing', async () => {
    const t = await setup({});
    await expect(createEnterprise(input(), t.ctx)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'create_closed' } });
    expect(t.log).toEqual([]);
    expect(await t.real.list()).toHaveLength(1);
  });

  it('runs create, init, activate in this order and answers a valid view with the first Admin and state active', async () => {
    const t = await setup();
    const view = await createEnterprise(input(), t.ctx);
    expect(t.log).toEqual(['create', 'init', 'activate']);
    expect(EnterpriseView.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({ id: 'ent_002', state: 'active', firstAdmin: { name: 'Sara', email: 'sara@acme.test' }, hasOwner: false });
  });

  it('sends the code prefix of the address and the language of the Admin to init', async () => {
    const t = await setup();
    await createEnterprise(input(), t.ctx);
    expect(t.inits[0]).toMatchObject({ ent: 'ent_002', address: 'acme-co', codePrefix: 'AC', admin: { name: 'Sara', email: 'sara@acme.test', language: 'ar' }, limits: { people: 5, storageBytes: 1024 } });
  });

  it('leaves the row creating after a failed init, and the same call again ends active with one invitation', async () => {
    const t = await setup();
    t.failInit(true);
    await expect(createEnterprise(input(), t.ctx)).rejects.toThrow('did not start');
    expect((await t.real.getEnterprise({ ent: 'ent_002' }))?.state).toBe('creating');
    expect(t.log).toEqual(['create', 'init']);
    t.log.length = 0;
    t.failInit(false);
    const view = await createEnterprise(input(), t.ctx);
    expect(t.log).toEqual(['create', 'init', 'activate']);
    expect(view.state).toBe('active');
    expect((await t.real.list()).map((row) => row.id)).toEqual(['ent_001', 'ent_002']);
    expect(t.invitations()).toBe(1);
  });

  it('maps address_taken and email_taken to invalid_input with the reason', async () => {
    const t = await setup();
    await createEnterprise(input(), t.ctx);
    await expect(createEnterprise(input({ admin: { name: 'X', email: 'x@acme.test', language: 'en' } }), t.ctx)).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['address'], reason: 'address_taken' },
    });
    await expect(createEnterprise(input({ address: 'initech', admin: { name: 'O', email: 'O@vado.test', language: 'en' } }), t.ctx)).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['admin.email'], reason: 'email_taken' },
    });
  });

  it('never names another enterprise in the email_taken text', async () => {
    const t = await setup();
    const error = await createEnterprise(input({ admin: { name: 'O', email: 'o@vado.test', language: 'en' } }), t.ctx).catch((e: Error) => e);
    expect(JSON.stringify({ message: (error as Error).message, details: (error as { details?: unknown }).details })).not.toMatch(/ent_00|vado/i);
  });
});
