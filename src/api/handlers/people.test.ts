import { beforeEach, describe, expect, it } from 'vitest';
import { peopleCalls } from './people';
import { historyCalls } from './history';
import { makeUser, NOW, testApi } from '../../test/factories';
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
    expect(created).toMatchObject({ id: 'usr_006', systemRole: 'member', kind: 'human', active: true });
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

  it('takes the client name in English, Arabic or both, and refuses neither (colleague comments 10 and 11)', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const arabic = await t.api.call('clients.create', { nameAr: 'تمر للضيافة' });
    expect(arabic).toMatchObject({ name: '', nameAr: 'تمر للضيافة' });
    const both = await t.api.call('clients.create', { name: 'Tamr Hospitality', nameAr: 'تمر للضيافة', contactName: 'Tamr Hospitality' });
    expect(both).toMatchObject({ name: 'Tamr Hospitality', nameAr: 'تمر للضيافة', contactName: 'Tamr Hospitality' });
    await expect(t.api.call('clients.create', { name: ' ', nameAr: '' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_001');
    await expect(t.api.call('clients.update', { id: both.id, patch: { name: '', nameAr: '' } })).rejects.toMatchObject({ code: 'invalid_input' });
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

describe('Admins are people', () => {
  it('refuses the Admin role for an agent', async () => {
    const t = testApi(peopleCalls);
    await expect(t.api.call('users.create', { name: 'Admin bot', email: 'bot@madar.test', kind: 'agent', ownerId: 'usr_001', systemRole: 'admin', discipline: 'Bot' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'agent_admin' } });
    await expect(t.api.call('users.update', { id: 'usr_005', patch: { systemRole: 'admin' } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'agent_admin' } });
  });

  it('counts only active people, not agents, as the last Admin', async () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_005.systemRole = 'admin';
    await expect(t.api.call('users.update', { id: 'usr_001', patch: { systemRole: 'member' } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'last_admin' } });
  });

  it('names the reason when an email is taken', async () => {
    const t = testApi(peopleCalls);
    const taken = t.store.state.users.usr_002.email;
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { email: taken } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'email_taken', fields: ['email'] } });
  });
});

// Management and Accounting roles (colleague comments 6 and 13, owner, 2026-10-01).
// usr_001 is the Admin, usr_003 is a member. usr_006 is Management, usr_007 is Accounting, usr_008 is an agent of the Admin, usr_009 is an agent of usr_003.
function roleWorld() {
  const t = testApi({ ...peopleCalls, ...historyCalls });
  const users = t.store.state.users;
  users.usr_006 = makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' });
  users.usr_007 = makeUser('usr_007', { name: 'Noura Accounting', systemRole: 'accounting' });
  users.usr_008 = makeUser('usr_008', { name: 'Admin Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
  users.usr_009 = makeUser('usr_009', { name: 'Member Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_003' });
  t.store.state.counters.usr = 9;
  return t;
}
const PERSON = { name: 'New Person', email: 'new@madar.test', discipline: 'MEP' };

describe('Management and people', () => {
  it('lets Management add a person with any role except Admin', async () => {
    const t = roleWorld();
    t.as('usr_006');
    for (const systemRole of ['member', 'management', 'accounting'] as const) {
      const created = await t.api.call('users.create', { ...PERSON, email: `${systemRole}@madar.test`, systemRole });
      expect(created.systemRole).toBe(systemRole);
    }
    await expect(t.api.call('users.create', { ...PERSON, systemRole: 'admin' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(Object.values(t.store.state.users).filter((u) => u.systemRole === 'admin')).toHaveLength(1);
  });

  it('lets Management change a role among member, management and accounting, and turn a person off', async () => {
    const t = roleWorld();
    t.as('usr_006');
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } })).systemRole).toBe('accounting');
    expect((await t.api.call('users.update', { id: 'usr_007', patch: { systemRole: 'member' } })).systemRole).toBe('member');
    expect((await t.api.call('users.deactivate', { id: 'usr_004' })).active).toBe(false);
  });

  it('never lets Management make an Admin, change an Admin, or change an Admin through another path', async () => {
    const t = roleWorld();
    t.as('usr_006');
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'admin' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_006', patch: { systemRole: 'admin' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_001', patch: { systemRole: 'member' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_001', patch: { name: 'Renamed' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_001', patch: { email: 'other@madar.test' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.deactivate', { id: 'usr_001' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.users.usr_001).toMatchObject({ systemRole: 'admin', name: 'Hala Admin', active: true });
    expect(t.store.state.users.usr_003.systemRole).toBe('member');
  });

  // The sign-in email is the key to the account: a new email goes to Auth confirmed at once (server/auth/admin.ts), so a
  // person who can change it can sign in as that person with "Forgot password" (security review of P2, 2026-10-04).
  it('lets only an Admin change the email of a person, never Management and never an agent', async () => {
    const t = roleWorld();
    t.as('usr_006');
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { email: 'mine@madar.test' } }))
      .rejects.toMatchObject({ code: 'forbidden', details: { action: 'people.email' } });
    await expect(t.api.call('users.update', { id: 'usr_007', patch: { email: 'mine@madar.test' } }))
      .rejects.toMatchObject({ code: 'forbidden', details: { action: 'people.email' } });
    // The same email is no change, so the other fields of a full form still save.
    const same = t.store.state.users.usr_003.email;
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { email: same, name: 'Renamed' } })).name).toBe('Renamed');
    t.as('usr_008');
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { email: 'agent@madar.test' } }))
      .rejects.toMatchObject({ code: 'forbidden', details: { action: 'people.email' } });
    expect(t.store.state.users.usr_003.email).toBe(same);
    t.as('usr_001');
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { email: 'new-address@madar.test' } })).email).toBe('new-address@madar.test');
  });

  it('refuses Management every new agent and every call about an agent of an Admin', async () => {
    const t = roleWorld();
    t.as('usr_006');
    // An agent acts with the rights of its owner. An agent for the Admin has the Admin's rights.
    await expect(t.api.call('users.create', { ...PERSON, kind: 'agent', ownerId: 'usr_001' })).rejects.toMatchObject({ code: 'forbidden' });
    // Also an agent for itself, and an agent for a member.
    await expect(t.api.call('users.create', { ...PERSON, kind: 'agent', ownerId: 'usr_006' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.create', { ...PERSON, kind: 'agent', ownerId: 'usr_003' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_008', patch: { name: 'Mine now' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.deactivate', { id: 'usr_008' })).rejects.toMatchObject({ code: 'forbidden' });
    // There is no way to give an agent another owner: the update call has no owner field.
    await expect(t.api.call('users.update', { id: 'usr_009', patch: { ownerId: 'usr_001' } as never })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('users.update', { id: 'usr_009', patch: { ownerId: 'usr_006' } as never })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.users.usr_009.ownerId).toBe('usr_003');
    expect(t.store.state.users.usr_008).toMatchObject({ ownerId: 'usr_001', active: true, name: 'Admin Agent' });
    expect(Object.values(t.store.state.users).filter((u) => u.kind === 'agent')).toHaveLength(3);
  });

  it('lets the Admin add an agent for anyone and change any person, an Admin included', async () => {
    const t = roleWorld();
    const forAdmin = await t.api.call('users.create', { ...PERSON, kind: 'agent', ownerId: 'usr_001' });
    expect(forAdmin).toMatchObject({ kind: 'agent', ownerId: 'usr_001', systemRole: 'member' });
    expect(await t.api.call('users.create', { ...PERSON, email: 'b@madar.test', kind: 'agent', ownerId: 'usr_006' })).toMatchObject({ ownerId: 'usr_006' });
    expect(await t.api.call('users.create', { ...PERSON, email: 'c@madar.test', kind: 'agent', ownerId: 'usr_003' })).toMatchObject({ ownerId: 'usr_003' });
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'admin' } })).systemRole).toBe('admin');
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'management' } })).systemRole).toBe('management');
    expect((await t.api.call('users.update', { id: 'usr_008', patch: { name: 'Renamed agent' } })).name).toBe('Renamed agent');
    await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'admin' } });
    expect((await t.api.call('users.deactivate', { id: 'usr_003' })).active).toBe(false);
  });

  it('keeps an agent a member, and refuses the last Admin leaving', async () => {
    const t = roleWorld();
    await expect(t.api.call('users.update', { id: 'usr_009', patch: { systemRole: 'management' } })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'agent_role' } });
    await expect(t.api.call('users.update', { id: 'usr_009', patch: { systemRole: 'admin' } })).rejects.toMatchObject({ details: { reason: 'agent_admin' } });
    await expect(t.api.call('users.create', { ...PERSON, kind: 'agent', ownerId: 'usr_003', systemRole: 'accounting' })).rejects.toMatchObject({ details: { reason: 'agent_role' } });
    await expect(t.api.call('users.update', { id: 'usr_001', patch: { systemRole: 'accounting' } })).rejects.toMatchObject({ details: { reason: 'last_admin' } });
  });

  it('refuses Accounting, a member and an agent of a member every people call', async () => {
    const t = roleWorld();
    for (const user of ['usr_007', 'usr_003', 'usr_009']) {
      t.as(user);
      await expect(t.api.call('users.create', { ...PERSON })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(t.api.call('users.update', { id: 'usr_004', patch: { systemRole: 'accounting' } })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(t.api.call('users.deactivate', { id: 'usr_004' })).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('keeps the agent of Management as strong as Management, and no stronger', async () => {
    const t = roleWorld();
    t.store.state.users.usr_009.ownerId = 'usr_006';
    t.as('usr_009');
    expect((await t.api.call('users.create', { ...PERSON, systemRole: 'accounting' })).systemRole).toBe('accounting');
    await expect(t.api.call('users.create', { ...PERSON, email: 'z@madar.test', systemRole: 'admin' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_001', patch: { name: 'x' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps the office settings and the clients with the Admin', async () => {
    const t = roleWorld();
    t.store.state.clients.cli_001 = { id: 'cli_001', name: 'Client', contactName: '', phone: '', email: '' };
    for (const user of ['usr_006', 'usr_007']) {
      t.as(user);
      await expect(t.api.call('settings.update', { workloadLimit: 20 })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(t.api.call('clients.update', { id: 'cli_001', patch: { name: 'Other' } })).rejects.toMatchObject({ code: 'forbidden' });
    }
    t.as('usr_001');
    expect((await t.api.call('settings.update', { workloadLimit: 20 })).workloadLimit).toBe(20);
  });

  it('shows the role in the Preview as list', async () => {
    const t = roleWorld();
    const hints = Object.fromEntries((await t.api.call('session.get', {})).previewUsers.map((u) => [u.id, u.hint]));
    expect(hints).toMatchObject({ usr_001: 'admin', usr_006: 'management', usr_007: 'accounting', usr_002: 'leader', usr_003: 'member' });
  });

  it('undoes its own change to a person, and refuses an undo that touches an Admin', async () => {
    const t = roleWorld();
    t.as('usr_006');
    await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } }, { correlationId: 'story_role' });
    await t.api.call('events.undoStory', { correlationId: 'story_role' });
    expect(t.store.state.users.usr_003.systemRole).toBe('member');
    await t.api.call('users.update', { id: 'usr_004', patch: { systemRole: 'accounting' } }, { correlationId: 'story_two' });
    // An Admin made that person an Admin since. Management cannot undo its change to a person who is now an Admin.
    t.store.state.users.usr_004.systemRole = 'admin';
    await expect(t.api.call('events.undoStory', { correlationId: 'story_two' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.users.usr_004.systemRole).toBe('admin');
  });
});

describe('the language of a new person (plan 4.13, A8; spec 2, section 10)', () => {
  it('takes the language of the Admin who creates the person, when the form names none', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_001');
    expect((await t.api.call('users.create', { name: 'New One', email: 'one@madar.test', discipline: 'MEP' })).preferences.language).toBe('en');
    t.store.state.users.usr_001.preferences.language = 'ar';
    expect((await t.api.call('users.create', { name: 'New Two', email: 'two@madar.test', discipline: 'MEP' })).preferences.language).toBe('ar');
  });

  it('keeps an explicit language in preferences.language', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_001');
    const created = await t.api.call('users.create', { name: 'New Three', email: 'three@madar.test', discipline: 'MEP', language: 'ar' });
    expect(created.preferences.language).toBe('ar');
    expect(t.store.state.users[created.id].preferences.language).toBe('ar');
    await expect(t.api.call('users.create', { name: 'New Four', email: 'four@madar.test', discipline: 'MEP', language: 'fr' } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('me.updatePreferences keeps the switches it does not name (review of A7, 2026-10-03)', () => {
  it('keeps the email switches and the morning summary when the theme changes', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const user = t.store.state.users.usr_003;
    user.preferences = { ...user.preferences, email: { mention: false }, morningSummary: false };
    const after = await t.api.call('me.updatePreferences', { theme: 'dark' });
    expect(after.preferences.theme).toBe('dark');
    expect(after.preferences.email).toEqual({ mention: false });
    expect(after.preferences.morningSummary).toBe(false);
    expect(t.store.state.users.usr_003.preferences.morningSummary).toBe(false);
  });
});
