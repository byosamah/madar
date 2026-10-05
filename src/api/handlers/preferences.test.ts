import { beforeEach, describe, expect, it } from 'vitest';
import { defaultPreferences, User } from '../contract/entities';
import { peopleCalls } from './people';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

// The owner (2026-10-05, item 11): a new person starts with the light theme. A person who exists keeps their choice.
describe('the theme of a new person (owner, 2026-10-05, item 11)', () => {
  it('starts light', () => {
    expect(defaultPreferences().theme).toBe('light');
  });

  it('gives a person that the Admin adds the light theme, and leaves the others as they are', async () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_003.preferences = { ...t.store.state.users.usr_003.preferences, theme: 'system' };
    const created = await t.api.call('users.create', { name: 'New Person', email: 'new@madar.test', discipline: 'MEP' });
    expect(created.preferences.theme).toBe('light');
    expect(t.store.state.users.usr_003.preferences.theme).toBe('system');
  });
});

// The owner (2026-10-05, item 9): one personal switch turns the hatch of two stages at the same time on and off.
describe('the hatch switch (owner, 2026-10-05, item 9)', () => {
  it('reads a person saved before the switch existed as on', () => {
    const { hatchOverlap: _gone, ...old } = defaultPreferences();
    const person = User.parse({
      id: 'usr_009', name: 'Old Person', email: 'old@madar.test', avatarUrl: null, kind: 'human', systemRole: 'member',
      discipline: 'MEP', active: true, ownerId: null, preferences: old,
    });
    expect(person.preferences.hatchOverlap).toBeUndefined();
  });

  it('saves the switch for the person only, and keeps the other choices', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const after = await t.api.call('me.updatePreferences', { hatchOverlap: false });
    expect(after.preferences.hatchOverlap).toBe(false);
    expect(t.store.state.users.usr_003.preferences.hatchOverlap).toBe(false);
    expect(t.store.state.users.usr_002.preferences.hatchOverlap).toBeUndefined();
    const themed = await t.api.call('me.updatePreferences', { theme: 'dark' });
    expect(themed.preferences.hatchOverlap).toBe(false);
    expect((await t.api.call('me.updatePreferences', { hatchOverlap: true })).preferences.hatchOverlap).toBe(true);
  });
});
