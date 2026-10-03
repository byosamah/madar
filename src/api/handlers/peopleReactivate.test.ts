import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { peopleCalls } from './people';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const office = () => testApi({ ...peopleCalls, ...historyCalls });

describe('turning a deactivated person on again (audit 2026-10-03, SHL-7)', () => {
  it('lets the Admin turn a person on again, with Undo', async () => {
    const t = office();
    await t.api.call('users.deactivate', { id: 'usr_004' });
    const back = await t.api.call('users.reactivate', { id: 'usr_004' }, { correlationId: 'cor_back' });
    expect(back.active).toBe(true);
    expect(t.store.state.users.usr_004.active).toBe(true);
    await t.api.call('events.undoStory', { correlationId: 'cor_back' });
    expect(t.store.state.users.usr_004.active).toBe(false);
  });

  it('follows the rules of Deactivate for Management', async () => {
    const t = office();
    const s = t.store.state;
    s.users.usr_002.systemRole = 'management';
    s.users.usr_005.ownerId = 'usr_001';
    s.users.usr_004.active = false;
    s.users.usr_005.active = false;
    t.as('usr_002');
    expect((await t.api.call('users.reactivate', { id: 'usr_004' })).active).toBe(true);
    await expect(t.api.call('users.reactivate', { id: 'usr_005' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('users.reactivate', { id: 'usr_005' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an agent whose person is not active', async () => {
    const t = office();
    const s = t.store.state;
    s.users.usr_003.active = false;
    s.users.usr_005.active = false;
    await expect(t.api.call('users.reactivate', { id: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
