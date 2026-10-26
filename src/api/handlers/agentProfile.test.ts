import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The own profile, the preferences and the logos for an agent (MCP parity, owner 2026-10-26). usr_005 is an agent of Sara (usr_003), a test agent of the Admin (usr_001) is added by adminAgent. An agent changes the person it acts for, never its own record, and never a picture or a logo.
 */
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { action?: string } }) => error);
const PICTURE = 'https://example.com/me.png';

/** A test office whose current user is a new agent of the Admin (usr_001). */
function adminAgent() {
  const t = testApi(calls);
  t.store.state.users.usr_050 = { ...t.store.state.users.usr_005, id: 'usr_050', email: 'usr_050@madar.test', ownerId: 'usr_001' };
  t.as('usr_050');
  return t;
}

describe('me.updateProfile and me.updatePreferences for an agent', () => {
  it('changes the profile of the person and leaves the record of the agent as it is', async () => {
    const t = testApi(calls);
    t.as('usr_005');
    const agentBefore = JSON.stringify(t.store.state.users.usr_005);
    const saved = await t.api.call('me.updateProfile', { discipline: 'Site engineer', nameAr: 'سارة' });
    expect(saved.id).toBe('usr_003');
    expect(t.store.state.users.usr_003).toMatchObject({ discipline: 'Site engineer', nameAr: 'سارة' });
    expect(JSON.stringify(t.store.state.users.usr_005)).toBe(agentBefore);
    const event = Object.values(t.store.state.events).find((item) => item.verb === 'user.profile_changed')!;
    expect(event).toMatchObject({ targetId: 'usr_003', actorId: 'usr_005', actingForId: 'usr_003', actorKind: 'agent' });
  });

  it('changes the preferences of the person, and refuses quiet hours, Away and the choice of the Admin', async () => {
    const t = testApi(calls);
    t.as('usr_005');
    const agentBefore = JSON.stringify(t.store.state.users.usr_005.preferences);
    await t.api.call('me.updatePreferences', { theme: 'dark', language: 'ar' });
    expect(t.store.state.users.usr_003.preferences).toMatchObject({ theme: 'dark', language: 'ar' });
    expect(JSON.stringify(t.store.state.users.usr_005.preferences)).toBe(agentBefore);
    expect(await failureOf(t.api.call('me.updatePreferences', { awayByHand: true }))).toMatchObject({ code: 'forbidden', details: { action: 'me.away' } });
    expect(await failureOf(t.api.call('me.updatePreferences', { workHours: { quiet: false, days: [0], from: '08:00', to: '17:00' } }))).toMatchObject({ code: 'forbidden', details: { action: 'me.workHours' } });
  });

  it('refuses a picture from an agent, in me.updateProfile and in users.update, and keeps the picture of the person', async () => {
    const t = testApi(calls);
    t.as('usr_005');
    expect(await failureOf(t.api.call('me.updateProfile', { avatarUrl: PICTURE }))).toMatchObject({ code: 'forbidden', details: { action: 'me.picture' } });
    expect(t.store.state.users.usr_003.avatarUrl).toBeNull();
    const admin = adminAgent();
    expect(await failureOf(admin.api.call('users.update', { id: 'usr_003', patch: { avatarUrl: PICTURE } }))).toMatchObject({ code: 'forbidden', details: { action: 'people.picture' } });
    expect(admin.store.state.users.usr_003.avatarUrl).toBeNull();
    // A person still sets it: the rule is for the agent only.
    const person = testApi(calls);
    person.as('usr_003');
    expect((await person.api.call('me.updateProfile', { avatarUrl: PICTURE })).avatarUrl).toBe(PICTURE);
  });
});

describe('subCompanies.save for an agent', () => {
  it('makes and renames a sub-company, never sets or clears a logo, and keeps an old logo', async () => {
    const t = adminAgent();
    const made = await t.api.call('subCompanies.save', { name: 'Marsa Design', nameAr: 'مرسى للتصميم', logo: null });
    expect(made.logo).toBeNull();
    expect(await failureOf(t.api.call('subCompanies.save', { name: 'Marsa Two', nameAr: 'مرسى اثنان', logo: 'data:image/png;base64,AAAA' }))).toMatchObject({ code: 'forbidden', details: { action: 'subCompanies.logo' } });
    // An old logo stays when the agent renames: it sends null and the call keeps the stored one.
    t.store.state.subCompanies![made.id].logo = 'data:image/png;base64,AAAA';
    const renamed = await t.api.call('subCompanies.save', { id: made.id, name: 'Marsa Design Studio', nameAr: 'مرسى للتصميم', logo: null });
    expect(renamed).toMatchObject({ name: 'Marsa Design Studio', logo: 'data:image/png;base64,AAAA' });
    // A person still changes the logo.
    const person = testApi(calls);
    person.as('usr_001');
    const own = await person.api.call('subCompanies.save', { name: 'Own Co', nameAr: 'شركتي', logo: 'data:image/png;base64,AAAA' });
    expect(own.logo).toBe('data:image/png;base64,AAAA');
  });
});
