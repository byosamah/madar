import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/** Away by hand (chat presence design A2, base B4): a personal preference that only the person sets. usr_005 is an agent of Sara (usr_003). */
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { action?: string } }) => error);

describe('me.updatePreferences with awayByHand', () => {
  it('sets Away by hand and turns it off', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    expect(t.store.state.users.usr_003.preferences.awayByHand).toBeUndefined();
    const on = await t.api.call('me.updatePreferences', { awayByHand: true });
    expect(on.preferences.awayByHand).toBe(true);
    expect(t.store.state.users.usr_003.preferences.awayByHand).toBe(true);
    const off = await t.api.call('me.updatePreferences', { awayByHand: false });
    expect(off.preferences.awayByHand).toBe(false);
  });

  it('refuses Away by hand from an agent', async () => {
    const t = testApi(calls);
    t.as('usr_005');
    const error = await failureOf(t.api.call('me.updatePreferences', { awayByHand: true }));
    expect(error).toMatchObject({ code: 'forbidden', message: 'Only the person sets Away.', details: { action: 'me.away' } });
    expect(t.store.state.users.usr_003.preferences.awayByHand).toBeUndefined();
    expect(t.store.state.users.usr_005.preferences.awayByHand).toBeUndefined();
  });

  it('keeps the other preferences', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { theme: 'dark', hatchOverlap: false });
    const before = t.store.state.users.usr_003.preferences;
    await t.api.call('me.updatePreferences', { awayByHand: true });
    const after = t.store.state.users.usr_003.preferences;
    expect(after).toEqual({ ...before, awayByHand: true });
    // A later change of another preference keeps the switch.
    await t.api.call('me.updatePreferences', { language: 'ar' });
    expect(t.store.state.users.usr_003.preferences).toMatchObject({ awayByHand: true, language: 'ar', theme: 'dark', hatchOverlap: false });
  });
});

/**
 * Away by hand is a private choice (chat design anti-goals: no history of status, nobody learns more than "Away"). The History and the
 * people list are open to every signed-in person, so neither may carry the switch of another person.
 */
describe('Away by hand stays private', () => {
  const historyText = (t: ReturnType<typeof testApi>) => JSON.stringify(Object.values(t.store.state.events));

  it('writes no History event for the switch alone, and keeps its value out of the event of another change', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const before = Object.keys(t.store.state.events).length;
    await t.api.call('me.updatePreferences', { awayByHand: true });
    expect(Object.keys(t.store.state.events)).toHaveLength(before);
    await t.api.call('me.updatePreferences', { theme: 'dark' });
    expect(Object.keys(t.store.state.events)).toHaveLength(before + 1);
    expect(historyText(t)).not.toContain('awayByHand');
    expect(t.store.state.users.usr_003.preferences).toMatchObject({ awayByHand: true, theme: 'dark' });
    await t.api.call('notifications.updateSettings', { trigger: 'mention', on: false });
    expect(historyText(t)).not.toContain('awayByHand');
    expect(t.store.state.users.usr_003.preferences.awayByHand).toBe(true);
  });

  it('keeps the switch when a person undoes an older change of preferences', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { theme: 'dark' });
    await t.api.call('me.updatePreferences', { awayByHand: true });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'user.preferences_changed')!;
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.users.usr_003.preferences).toMatchObject({ theme: expect.not.stringMatching(/^dark$/), awayByHand: true });
    expect(historyText(t)).not.toContain('awayByHand');
  });

  it('hides the switch of another person in users.list and users.get, and shows it to the person', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { awayByHand: true });
    t.as('usr_002');
    const list = await t.api.call('users.list', {});
    expect(list.find((user) => user.id === 'usr_003')?.preferences).not.toHaveProperty('awayByHand');
    expect((await t.api.call('users.get', { id: 'usr_003' })).preferences).not.toHaveProperty('awayByHand');
    t.as('usr_003');
    expect((await t.api.call('users.list', {})).find((user) => user.id === 'usr_003')?.preferences.awayByHand).toBe(true);
    expect((await t.api.call('users.get', { id: 'usr_003' })).preferences.awayByHand).toBe(true);
  });

  it('hides Away by hand of another person in every answer that returns a person', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { awayByHand: true });
    t.as('usr_001');
    const answers = [
      (await t.api.call('users.get', { id: 'usr_003' })),
      (await t.api.call('users.list', {})).find((user) => user.id === 'usr_003')!,
      await t.api.call('users.update', { id: 'usr_003', patch: { discipline: 'Engineer' } }),
      await t.api.call('users.deactivate', { id: 'usr_003' }),
      await t.api.call('users.reactivate', { id: 'usr_003' }),
    ];
    for (const answer of answers) {
      expect(answer.id).toBe('usr_003');
      expect(JSON.stringify(answer)).not.toContain('awayByHand');
    }
    // The stored record keeps it, and the person still reads it.
    expect(t.store.state.users.usr_003.preferences.awayByHand).toBe(true);
    t.as('usr_003');
    expect((await t.api.call('users.get', { id: 'usr_003' })).preferences.awayByHand).toBe(true);
  });
});
