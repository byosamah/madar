import { beforeEach, describe, expect, it } from 'vitest';
import { peopleCalls } from './people';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

describe('session calls', () => {
  it('returns the current user and the preview list', async () => {
    const { api } = testApi(peopleCalls);
    const session = await api.call('session.get', {});
    expect(session.user.id).toBe('usr_001');
    expect(session.persistent).toBe(false);
    expect(session.simulateErrors).toBe(false);
    const hints = Object.fromEntries(session.previewUsers.map((u) => [u.id, u.hint]));
    expect(hints).toEqual({ usr_001: 'admin', usr_002: 'leader', usr_003: 'member', usr_004: 'member', usr_005: 'agent' });
  });

  it('switches the current user', async () => {
    const { api } = testApi(peopleCalls);
    await api.call('session.previewAs', { userId: 'usr_003' });
    expect((await api.call('session.get', {})).user.id).toBe('usr_003');
  });

  it('refuses to preview an inactive person', async () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_004.active = false;
    await expect(t.api.call('session.previewAs', { userId: 'usr_004' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('turns simulated errors on', async () => {
    const t = testApi(peopleCalls);
    expect(await t.api.call('session.setSimulateErrors', { on: true })).toEqual({ simulateErrors: true });
    expect(t.store.state.session.simulateErrors).toBe(true);
  });
});

describe('people calls', () => {
  it('lets only the Admin add people', async () => {
    const t = testApi(peopleCalls);
    const created = await t.api.call('users.create', { name: 'New Person', email: 'new@madar.test', discipline: 'MEP' });
    expect(created).toMatchObject({ id: 'usr_006', systemRole: 'member', kind: 'human', weeklyHourTarget: 40, active: true });
    t.as('usr_003');
    await expect(t.api.call('users.create', { name: 'X', email: 'x@madar.test', discipline: 'MEP' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a duplicate email', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.create', { name: 'X', email: 'USR_002@madar.test', discipline: 'MEP' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['email'] },
    });
  });

  it('keeps at least one Admin', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.update', { id: 'usr_001', patch: { systemRole: 'member' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('gives every agent a person to act for', async () => {
    const t = testApi(peopleCalls);
    await expect(t.api.call('users.create', { name: 'Bot', email: 'bot@madar.test', discipline: 'Agent', kind: 'agent' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['ownerId'] },
    });
    const agent = await t.api.call('users.create', { name: 'Bot', email: 'bot@madar.test', discipline: 'Agent', kind: 'agent', ownerId: 'usr_002' });
    expect(agent.ownerId).toBe('usr_002');
    t.as(agent.id);
    const session = await t.api.call('session.get', {});
    expect(session.actingFor?.id).toBe('usr_002');
    expect(session.previewUsers.find((u) => u.id === 'usr_005')?.actingForName).toBe('Sara Team');
  });

  it('stops the Admin from turning off their own account', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.deactivate', { id: 'usr_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await api.call('users.deactivate', { id: 'usr_004' })).active).toBe(false);
  });

  it('saves my preferences and my profile', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const prefs = await t.api.call('me.updatePreferences', { language: 'ar', theme: 'dark' });
    expect(prefs.preferences).toMatchObject({ language: 'ar', theme: 'dark', glass: 'frosted' });
    const profile = await t.api.call('me.updateProfile', { name: 'Sara Al-Qahtani', discipline: 'Interior' });
    expect(profile).toMatchObject({ name: 'Sara Al-Qahtani', discipline: 'Interior' });
  });
});

describe('client and settings calls', () => {
  it('lets anyone add a client and only the Admin edit one', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const client = await t.api.call('clients.create', { name: 'Gulf Crest Holding' });
    expect(client).toMatchObject({ id: 'cli_001', contactName: '', email: '' });
    await expect(t.api.call('clients.update', { id: client.id, patch: { phone: '+966 13 864 1000' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    expect((await t.api.call('clients.update', { id: client.id, patch: { phone: '+966 13 864 1000' } })).phone).toBe('+966 13 864 1000');
  });

  it('lets only the Admin change settings and checks the code prefix', async () => {
    const t = testApi(peopleCalls);
    expect((await t.api.call('settings.update', { workloadLimit: 8 })).workloadLimit).toBe(8);
    await expect(t.api.call('settings.update', { codePrefix: 'kh' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_002');
    await expect(t.api.call('settings.update', { workloadLimit: 12 })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('review fixes', () => {
  it('does not let anyone turn a person into an agent or back', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.update', { id: 'usr_001', patch: { kind: 'agent' } } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('returns the authority with its preferences', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_005');
    const session = await t.api.call('session.get', {});
    expect(session.authority.id).toBe('usr_003');
    expect(session.authority.preferences.notifications.mention).toBe(true);
  });
});
