import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { reason?: string; fields?: string[] } }) => error);

const WORK = { quiet: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' };

/** Quiet hours (owner, 2026-10-22, fbk_048): a person sets work days and one time range. The Admin lock keeps the range wide enough. */
describe('me.updatePreferences with workHours', () => {
  it('saves the work hours for the person only, and keeps the other choices', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { theme: 'dark' });
    const wide = { quiet: true, days: [0, 1, 2, 3, 4, 5], from: '07:30', to: '19:00' };
    const after = await t.api.call('me.updatePreferences', { workHours: wide });
    expect(after.preferences.workHours).toEqual(wide);
    expect(after.preferences.theme).toBe('dark');
    expect(t.store.state.users.usr_003.preferences.workHours).toEqual(wide);
    expect(t.store.state.users.usr_002.preferences.workHours).toBeUndefined();
    // A later change of another choice keeps the work hours.
    await t.api.call('me.updatePreferences', { language: 'ar' });
    expect(t.store.state.users.usr_003.preferences.workHours).toEqual(wide);
  });

  it('sorts the days and writes one event of the change', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { workHours: { ...WORK, days: [4, 0, 2, 1, 3, 5] } });
    expect(t.store.state.users.usr_003.preferences.workHours?.days).toEqual([0, 1, 2, 3, 4, 5]);
    const events = Object.values(t.store.state.events).filter((event) => event.verb === 'user.preferences_changed' && event.targetId === 'usr_003');
    expect(events).toHaveLength(1);
  });

  it('refuses a range that does not cover the lock, with the reason work_hours_lock', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    for (const workHours of [
      { ...WORK, from: '10:00' }, // starts after the lock
      { ...WORK, to: '16:30' }, // ends before the lock
      { ...WORK, days: [0, 1, 2, 3] }, // misses Thursday
    ]) {
      const error = await failureOf(t.api.call('me.updatePreferences', { workHours }));
      expect(error).toMatchObject({ code: 'invalid_input', details: { reason: 'work_hours_lock', fields: ['workHours'] } });
    }
    expect(t.store.state.users.usr_003.preferences.workHours).toBeUndefined();
  });

  it('always allows quiet hours off, also with a narrow range', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const off = { quiet: false, days: [0], from: '12:00', to: '13:00' };
    expect((await t.api.call('me.updatePreferences', { workHours: off })).preferences.workHours).toEqual(off);
  });

  it('refuses a bad range: no day, a repeated day, a step of 15 minutes, a start after the end', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    for (const workHours of [
      { ...WORK, days: [] },
      { ...WORK, days: [1, 1] },
      { ...WORK, days: [7] },
      { ...WORK, from: '09:15' },
      { ...WORK, from: '17:00', to: '09:00' },
      { ...WORK, from: '09:00', to: '09:00' },
      { ...WORK, to: '24:00' },
    ]) {
      expect(await failureOf(t.api.call('me.updatePreferences', { workHours })), JSON.stringify(workHours)).toMatchObject({ code: 'invalid_input' });
    }
  });

  it('lets a narrow range through while the Admin has the lock off', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('settings.update', { workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } } });
    t.as('usr_003');
    const narrow = { quiet: true, days: [0, 1], from: '11:00', to: '13:00' };
    expect((await t.api.call('me.updatePreferences', { workHours: narrow })).preferences.workHours).toEqual(narrow);
  });

  it('keeps a stored range when the Admin moves the lock later', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const mine = { quiet: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' };
    await t.api.call('me.updatePreferences', { workHours: mine });
    t.as('usr_001');
    await t.api.call('settings.update', { workHours: { days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '18:00', lock: { on: true, days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '18:00' } } });
    expect(t.store.state.users.usr_003.preferences.workHours).toEqual(mine);
  });
});

describe('settings.update with workHours', () => {
  const OFFICE = { days: [0, 1, 2, 3, 4], from: '08:30', to: '16:30', lock: { on: true, days: [0, 1, 2, 3, 4], from: '09:00', to: '16:00' } };

  it('saves the office default and the lock, and settings.get gives them to every signed-in person', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const saved = await t.api.call('settings.update', { workHours: OFFICE });
    expect(saved.workHours).toEqual(OFFICE);
    t.as('usr_003');
    expect((await t.api.call('settings.get', {})).workHours).toEqual(OFFICE);
  });

  it('keeps the other settings when only the work hours change', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const before = await t.api.call('settings.get', {});
    const saved = await t.api.call('settings.update', { workHours: OFFICE });
    expect({ ...saved, workHours: undefined }).toEqual({ ...before, workHours: undefined });
  });

  it('refuses a person without the office settings right', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    expect(await failureOf(t.api.call('settings.update', { workHours: OFFICE }))).toMatchObject({ code: 'forbidden' });
    expect(t.store.state.settings.workHours).toBeUndefined();
  });

  it('refuses a default range that leaves out the lock, with the reason work_hours_default_lock', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const error = await failureOf(t.api.call('settings.update', { workHours: { ...OFFICE, from: '10:00' } }));
    expect(error).toMatchObject({ code: 'invalid_input', details: { reason: 'work_hours_default_lock', fields: ['workHours'] } });
    expect(await failureOf(t.api.call('settings.update', { workHours: { ...OFFICE, days: [0, 1, 2, 3] } }))).toMatchObject({ details: { reason: 'work_hours_default_lock' } });
  });

  it('allows a default range that leaves out the lock while the lock is off', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const saved = await t.api.call('settings.update', { workHours: { ...OFFICE, from: '11:00', lock: { ...OFFICE.lock, on: false } } });
    expect(saved.workHours?.from).toBe('11:00');
  });

  it('refuses a bad range', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    for (const workHours of [
      { ...OFFICE, days: [] },
      { ...OFFICE, from: '17:00', to: '09:00' },
      { ...OFFICE, lock: { ...OFFICE.lock, from: '16:00', to: '09:00' } },
      { ...OFFICE, lock: { ...OFFICE.lock, days: [] } },
      { ...OFFICE, lock: { ...OFFICE.lock, from: '09:10' } },
    ]) {
      expect(await failureOf(t.api.call('settings.update', { workHours })), JSON.stringify(workHours)).toMatchObject({ code: 'invalid_input' });
    }
  });
});

// Quiet hours decide when a push and an email go, so an agent may not undo the person's change to them (as for an email switch).
describe('the Undo of a change to the work hours', () => {
  it('is refused for an agent, and allowed for the person', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('me.updatePreferences', { workHours: { quiet: false, days: [0, 1], from: '10:00', to: '12:00' } });
    const event = Object.values(t.store.state.events).at(-1)!;
    const saved = structuredClone(t.store.state.users.usr_003.preferences);
    t.as('usr_005');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'notifications.email' } });
    expect(t.store.state.users.usr_003.preferences).toEqual(saved);
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.users.usr_003.preferences.workHours).toBeUndefined();
  });
});

// Only the person sets quiet hours (owner, 2026-10-22). An agent may not, as it may not set Away or what reaches the Admin.
describe('me.updatePreferences with workHours from an agent', () => {
  it('is refused and changes nothing, while the person own call still saves', async () => {
    const t = testApi(calls);
    t.as('usr_005'); // the agent of usr_003
    const error = await failureOf(t.api.call('me.updatePreferences', { workHours: { quiet: false, days: [0], from: '10:00', to: '12:00' } }));
    expect(error).toMatchObject({ code: 'forbidden', message: 'Only the person sets quiet hours.', details: { action: 'me.workHours' } });
    expect(t.store.state.users.usr_003.preferences.workHours).toBeUndefined();
    expect(t.store.state.users.usr_005.preferences.workHours).toBeUndefined();
    t.as('usr_003');
    const mine = { quiet: false, days: [0], from: '10:00', to: '12:00' };
    expect((await t.api.call('me.updatePreferences', { workHours: mine })).preferences.workHours).toEqual(mine);
  });
});
