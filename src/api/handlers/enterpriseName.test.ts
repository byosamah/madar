import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeWorld, NOW, testApi } from '../../test/factories';
import { executeParsed, type ExecuteBase } from '../execute';
import { reportsCalls } from './reports';
import { peopleCalls, type SettingsPrepared } from './people';

beforeEach(() => setNow(NOW));

const LOGO = `data:image/png;base64,${'iVBORw0KGgo'.repeat(5)}`;
const at = new Date('2026-09-30T06:00:00Z');
const base = (actorId: string, extra: Partial<ExecuteBase> = {}): ExecuteBase => ({ actorId, authorityId: actorId, correlationId: 'cor_x', now: at, persistent: true, ...extra });
const calls = { ...peopleCalls, ...reportsCalls };

describe('the enterprise name and logo in Settings', () => {
  it('lets the Admin save the name, the Arabic name and the logo, and takes the logo off again', async () => {
    const t = testApi(peopleCalls);
    const saved = await t.api.call('settings.update', { enterpriseName: 'Acme Co', enterpriseNameAr: 'أكمي', enterpriseLogo: LOGO });
    expect(saved).toMatchObject({ enterpriseName: 'Acme Co', enterpriseNameAr: 'أكمي', enterpriseLogo: LOGO });
    expect((await t.api.call('settings.get', {})).enterpriseName).toBe('Acme Co');
    expect((await t.api.call('settings.update', { enterpriseLogo: null })).enterpriseLogo).toBeNull();
  });

  it('refuses a Member, and a logo that is no picture data', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    await expect(t.api.call('settings.update', { enterpriseName: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await expect(t.api.call('settings.update', { enterpriseLogo: 'http://x' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('settings.update', { enterpriseLogo: 'data:text/html;base64,AAAA' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('reads a Settings row without the fields', async () => {
    const t = testApi(peopleCalls);
    const got = await t.api.call('settings.get', {});
    expect(got).not.toHaveProperty('enterpriseName');
    expect(got).not.toHaveProperty('usage');
  });
});

describe('session.get in an enterprise', () => {
  const run = (state = makeWorld(), extra: Partial<ExecuteBase> = {}) => executeParsed(peopleCalls['session.get'], 'session.get', {}, state, base('usr_001', extra), undefined) as Record<string, unknown>;

  it('gives the enterprise with the name and the logo of the Settings, and the platform owner flag', () => {
    const state = makeWorld();
    state.settings.enterpriseName = 'Acme Co';
    state.settings.enterpriseNameAr = 'أكمي';
    state.settings.enterpriseLogo = LOGO;
    expect(run(state, { enterprise: { id: 'ent_002', platformOwner: true } })).toMatchObject({
      enterprise: { id: 'ent_002', name: 'Acme Co', nameAr: 'أكمي', logo: LOGO }, platformOwner: true,
    });
  });

  it('falls back to Madar and leaves the flag out for a person who is no owner', () => {
    const out = run(makeWorld(), { enterprise: { id: 'ent_002', platformOwner: false } });
    expect(out.enterprise).toEqual({ id: 'ent_002', name: 'Madar', nameAr: 'مدار', logo: null });
    expect(out).not.toHaveProperty('platformOwner');
  });

  it('gives neither key without the enterprise of the object', () => {
    const out = run();
    expect(out).not.toHaveProperty('enterprise');
    expect(out).not.toHaveProperty('platformOwner');
  });
});

describe('the report header', () => {
  const header = async (setup: (t: ReturnType<typeof testApi<typeof calls>>) => void, input: Record<string, unknown> = {}) => {
    const t = testApi(calls);
    setup(t);
    const report = await t.api.call('reports.office', { period: 'week', ...input } as never);
    return (report as { office: { name: string } }).office.name;
  };

  it('is Madar with no enterprise name, the enterprise name when set, and the sub-company name when one is named', async () => {
    expect(await header(() => undefined)).toBe('Madar');
    expect(await header((t) => { t.store.state.settings.enterpriseName = 'Acme Co'; })).toBe('Acme Co');
    const sub = (t: ReturnType<typeof testApi<typeof calls>>) => {
      t.store.state.settings.enterpriseName = 'Acme Co';
      (t.store.state.subCompanies ??= {}).sub_001 = { id: 'sub_001', name: 'Acme North', nameAr: 'أكمي', logo: null, createdAt: '2026-09-30T06:00:00.000Z' } as never;
    };
    expect(await header(sub, { subCompanyId: 'sub_001' })).toBe('Acme North');
  });
});

describe('settings.get usage', () => {
  const prepared: SettingsPrepared = { peopleLimit: 5, storageUsed: 7, storageLimit: null };
  const get = (actor: string, value: SettingsPrepared | undefined) =>
    executeParsed(peopleCalls['settings.get'], 'settings.get', {}, makeWorld(), base(actor), value) as Record<string, unknown>;

  it('gives no usage when the server gave no numbers', () => expect(get('usr_001', undefined)).not.toHaveProperty('usage'));

  it('gives the Admin the people used and the numbers of the server', () => {
    // The world holds 4 active people (usr_001 to usr_004) and one agent.
    expect(get('usr_001', prepared)).toMatchObject({ usage: { people: { used: 4, limit: 5 }, storage: { used: 7, limit: null } } });
  });

  it('leaves out a turned-off person and a removed person, and gives a Member nothing', () => {
    const state = makeWorld();
    state.users.usr_004!.active = false;
    state.users.usr_003!.removed = true;
    state.users.usr_003!.active = false;
    const out = executeParsed(peopleCalls['settings.get'], 'settings.get', {}, state, base('usr_001'), prepared) as { usage: { people: { used: number } } };
    expect(out.usage.people.used).toBe(2);
    expect(get('usr_003', prepared)).not.toHaveProperty('usage');
  });
});
