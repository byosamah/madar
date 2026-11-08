import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { EnterpriseView, PLATFORM_CALL_NAMES } from '../../../src/api/contract/platform';
import { ApiError } from '../../../src/api/errors';
import { nodeHost } from '../../data/lite/host';
import type { OfficeStub } from '../../entries/officeWorker';
import { recordingNet } from '../../office/test/fakes';
import { NODE_OFFICE_ENV } from '../../office/test/nodeOffice';
import { fixedClock } from '../../test/fakes/clock';
import { PLATFORM_HANDLERS, type PlatformCtx } from './handlers';
import { platformParts } from './parts';
import { applyPlatformSchema } from './schema';
import type { PlatformStub } from './stub';

const NOW = '2026-11-08T08:00:00.000Z';
const ACME = { name: 'Acme Co', nameAr: 'أكمي', address: 'acme-co', logo: null, limits: { people: 5, storageBytes: 1024 }, admin: { name: 'Sara', email: 'sara@acme.test', language: 'en' as const } };

async function setup() {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyPlatformSchema(host);
  const real = platformParts({ host, read: (name) => NODE_OFFICE_ENV[name], clock: fixedClock(NOW) });
  await real.register({
    row: { id: 'ent_001', address: 'vados', name: 'VADO', nameAr: 'فادو', state: 'active', limits: { people: null, storageBytes: null }, createdAt: NOW, firstAdmin: { name: 'O', email: 'o@vado.test' } },
    emails: ['o@vado.test'],
  });
  await real.setOwners({ owners: [{ ent: 'ent_001', userId: 'usr_001' }] });
  const log: string[] = [];
  const spy = (key: string) => key === 'setState' || key === 'update' || key === 'activate' || key === 'create';
  const platform = new Proxy(real, {
    get(target, key: string) {
      const value = (target as unknown as Record<string, unknown>)[key];
      if (typeof value === 'function' && spy(key)) return (...args: unknown[]) => (log.push(`platform.${key}`), (value as (...a: unknown[]) => unknown).apply(target, args));
      return value;
    },
  }) as unknown as PlatformStub;
  const calls = { failOn: undefined as string | undefined, reinviteAnswer: undefined as unknown };
  const record = (name: string) => async (input: unknown) => {
    log.push(`office.${name}`);
    if (calls.failOn === name) throw new Error(`The object failed ${name}.`);
    return input;
  };
  const office = {
    init: async () => (log.push('office.init'), { ok: true, value: { adminUserId: 'usr_001' } }),
    setState: record('setState'), setLimits: record('setLimits'), setIdentity: record('setIdentity'),
    reinvite: async () => (log.push('office.reinvite'), calls.reinviteAnswer ?? { ok: true, value: { sentAt: NOW } }),
  } as unknown as OfficeStub;
  const nets: string[] = [];
  const ctx: PlatformCtx = {
    ent: 'ent_001', userId: 'usr_001', platform, office: () => office, net: (ent) => (nets.push(ent), recordingNet()), read: (name) => (name === 'MADAR_ENTERPRISE_CREATE' ? 'open' : NODE_OFFICE_ENV[name]),
    now: () => new Date(NOW), log: { info() {}, warn() {}, error() {} },
  };
  const run = <N extends (typeof PLATFORM_CALL_NAMES)[number]>(name: N, input: Parameters<(typeof PLATFORM_HANDLERS)[N]>[0]) =>
    (PLATFORM_HANDLERS[name] as (i: unknown, c: PlatformCtx) => Promise<unknown>)(input, ctx);
  await run('platform.enterprises.create', ACME);
  log.length = 0;
  return { real, run, log, calls, ctx, nets };
}

describe('platform.me and platform.enterprises.list', () => {
  it('me gives owner true, the enterprise of the caller and whether create is open', async () => {
    const t = await setup();
    expect(await t.run('platform.me', {})).toEqual({ owner: true, ent: 'ent_001', createOpen: true });
  });

  it('list gives one valid view for each row, with hasOwner, the paused state and the first Admin', async () => {
    const t = await setup();
    await t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Acme Co' });
    const list = (await t.run('platform.enterprises.list', {})) as { id: string; state: string; hasOwner: boolean; firstAdmin: unknown }[];
    expect(list.map((row) => row.id)).toEqual(['ent_001', 'ent_002']);
    for (const row of list) expect(EnterpriseView.safeParse(row).success).toBe(true);
    expect(list[0]).toMatchObject({ hasOwner: true, state: 'active' });
    expect(list[1]).toMatchObject({ hasOwner: false, state: 'paused', firstAdmin: { name: 'Sara', email: 'sara@acme.test' } });
  });
});

describe('platform.enterprises.update', () => {
  it('calls the object first and the platform second, for the identity and for the limits', async () => {
    const t = await setup();
    const view = await t.run('platform.enterprises.update', { id: 'ent_002', patch: { name: 'Acme Renamed', limits: { people: 9 } } });
    expect(t.log).toEqual(['office.setIdentity', 'office.setLimits', 'platform.update']);
    expect(view).toMatchObject({ name: 'Acme Renamed', limits: { people: 9, storageBytes: 1024 } });
  });

  it('sends the object only the fields of the patch, so a logo the Admin set stays', async () => {
    const t = await setup();
    let sent: unknown;
    t.ctx.office = () => ({ setIdentity: async (input: unknown) => (sent = input), setLimits: async () => undefined }) as unknown as OfficeStub;
    await t.run('platform.enterprises.update', { id: 'ent_002', patch: { nameAr: 'اسم جديد' } });
    expect(sent).toEqual({ ent: 'ent_002', nameAr: 'اسم جديد' });
  });

  it('leaves the platform row as it was when the object call throws, and a repeat finishes it', async () => {
    const t = await setup();
    t.calls.failOn = 'setLimits';
    await expect(t.run('platform.enterprises.update', { id: 'ent_002', patch: { limits: { people: 9 } } })).rejects.toThrow('failed setLimits');
    expect((await t.real.getEnterprise({ ent: 'ent_002' }))?.limits.people).toBe(5);
    expect(t.log).not.toContain('platform.update');
    t.calls.failOn = undefined;
    await t.run('platform.enterprises.update', { id: 'ent_002', patch: { limits: { people: 9 } } });
    expect((await t.real.getEnterprise({ ent: 'ent_002' }))?.limits.people).toBe(9);
  });

  it('sets a limit to null (no limit) when the patch says null, and refuses a paused and a creating row', async () => {
    const t = await setup();
    expect(await t.run('platform.enterprises.update', { id: 'ent_002', patch: { limits: { storageBytes: null } } })).toMatchObject({ limits: { people: 5, storageBytes: null } });
    await t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Acme Co' });
    await expect(t.run('platform.enterprises.update', { id: 'ent_002', patch: { name: 'X' } })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'enterprise_paused' } });
    await t.real.create({ name: 'New', nameAr: 'جديد', address: 'initech', logo: null, limits: { people: null, storageBytes: null }, admin: { name: 'I', email: 'i@initech.test' } });
    await expect(t.run('platform.enterprises.update', { id: 'ent_003', patch: { name: 'X' } })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'not_finished' } });
  });
});

describe('platform.enterprises.pause and resume', () => {
  it('refuses the enterprise of an owner with owner_enterprise', async () => {
    const t = await setup();
    await expect(t.run('platform.enterprises.pause', { id: 'ent_001', confirmName: 'VADO' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'owner_enterprise' } });
    expect(t.log).toEqual([]);
  });

  it('refuses a name that does not match, and takes the trimmed English or Arabic name', async () => {
    const t = await setup();
    await expect(t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Acme' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['confirmName'], reason: 'name_mismatch' } });
    await expect(t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: '   ' })).rejects.toMatchObject({ details: { reason: 'name_mismatch' } });
    expect(t.log).toEqual([]);
    expect(await t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: ' Acme Co ' })).toMatchObject({ state: 'paused' });
    expect(t.log).toEqual(['office.setState', 'platform.setState']);
    expect(await t.run('platform.enterprises.resume', { id: 'ent_002' })).toMatchObject({ state: 'active' });
    expect(await t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'أكمي' })).toMatchObject({ state: 'paused' });
  });

  it('pauses twice with no harm, and resumes in the order object then platform', async () => {
    const t = await setup();
    await t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Acme Co' });
    await t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Acme Co' });
    t.log.length = 0;
    await t.run('platform.enterprises.resume', { id: 'ent_002' });
    expect(t.log).toEqual(['office.setState', 'platform.setState']);
  });

  it('leaves the platform row when the object call throws', async () => {
    const t = await setup();
    t.calls.failOn = 'setState';
    await expect(t.run('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Acme Co' })).rejects.toThrow();
    expect((await t.real.getEnterprise({ ent: 'ent_002' }))?.state).toBe('active');
  });

  it('refuses a creating row with not_finished', async () => {
    const t = await setup();
    await t.real.create({ name: 'New', nameAr: 'جديد', address: 'initech', logo: null, limits: { people: null, storageBytes: null }, admin: { name: 'I', email: 'i@initech.test' } });
    await expect(t.run('platform.enterprises.resume', { id: 'ent_003' })).rejects.toMatchObject({ details: { reason: 'not_finished' } });
    await expect(t.run('platform.enterprises.pause', { id: 'ent_003', confirmName: 'New' })).rejects.toMatchObject({ details: { reason: 'not_finished' } });
  });
});

describe('platform.enterprises.resendInvite', () => {
  it('asks for the network port of the enterprise that it works on, never the port of the caller (create and resendInvite)', async () => {
    const t = await setup();
    // setup made ent_002 with the owner of ent_001: its init got the port of ent_002.
    expect(t.nets).toEqual(['ent_002']);
    await t.run('platform.enterprises.resendInvite', { id: 'ent_002' });
    expect(t.nets).toEqual(['ent_002', 'ent_002']);
  });

  it('calls reinvite and gives sentAt', async () => {
    const t = await setup();
    expect(await t.run('platform.enterprises.resendInvite', { id: 'ent_002' })).toEqual({ sentAt: NOW });
    expect(t.log).toEqual(['office.reinvite']);
  });

  it('refuses a creating row, and maps a refusal of the object to an ApiError', async () => {
    const t = await setup();
    t.calls.reinviteAnswer = { ok: false, error: { code: 'conflict', message: 'This person accepted the invitation already.', details: { reason: 'already_accepted' } } };
    const error = await t.run('platform.enterprises.resendInvite', { id: 'ent_002' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'conflict', details: { reason: 'already_accepted' } });
    await t.real.create({ name: 'New', nameAr: 'جديد', address: 'initech', logo: null, limits: { people: null, storageBytes: null }, admin: { name: 'I', email: 'i@initech.test' } });
    await expect(t.run('platform.enterprises.resendInvite', { id: 'ent_003' })).rejects.toMatchObject({ details: { reason: 'not_finished' } });
  });

  it('answers not_found for an id that the platform does not hold', async () => {
    const t = await setup();
    await expect(t.run('platform.enterprises.resendInvite', { id: 'ent_099' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the handlers map', () => {
  it('has one handler for each of the 8 names', async () => {
    expect(Object.keys(PLATFORM_HANDLERS)).toEqual([...PLATFORM_CALL_NAMES]);
  });
});
