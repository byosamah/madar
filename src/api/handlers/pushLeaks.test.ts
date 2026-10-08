import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { setNow } from '../../lib/dates';
import { NOW, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/**
 * The leak probes of browser push (owner, 2026-10-08): a device and its endpoint belong to one person. Sara (usr_003) turns on
 * push on two browsers. Then everyone else reads everything that could carry a device: the Admin (usr_001), the leader of her project
 * (usr_002), an outsider (usr_004) and the agent of Sara (usr_005). No read and no list may hold the endpoint or the label.
 */
const SECRET_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/SECRET-ENDPOINT-OF-SARA-1';
const SECOND_ENDPOINT = 'https://web.push.apple.com/SECRET-ENDPOINT-OF-SARA-2';
const SECRET_LABEL = 'Sara private phone label';
const MARKS = ['SECRET-ENDPOINT-OF-SARA', SECRET_LABEL, 'pdv_001', 'pdv_002'];
const OTHERS = ['usr_001', 'usr_002', 'usr_004', 'usr_005'];

async function world() {
  const t = testApi(calls);
  t.as('usr_003');
  await t.api.call('push.register', { endpoint: SECRET_ENDPOINT, label: SECRET_LABEL });
  await t.api.call('push.register', { endpoint: SECOND_ENDPOINT, label: 'Safari on iPhone' });
  return t;
}

describe('a device is private to its person', () => {
  it('push.mine answers each other person with their own devices only, the Admin and the agent of the owner included', async () => {
    const t = await world();
    for (const userId of ['usr_001', 'usr_002', 'usr_004']) {
      t.as(userId);
      expect(await t.api.call('push.mine', {}), userId).toEqual([]);
    }
    // The agent of Sara is not Sara: it has no device calls at all.
    t.as('usr_005');
    await expect(t.api.call('push.mine', {})).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    expect(await t.api.call('push.mine', {})).toHaveLength(2);
  });

  it('shows no device in the History, the search, the notices, the chats, the people lists or the lists of projects and tasks', async () => {
    const t = await world();
    for (const userId of OTHERS) {
      t.as(userId);
      const reads: [string, unknown][] = [
        ['events.list', { limit: 500 }], ['search.query', { text: 'SECRET-ENDPOINT' }], ['search.query', { text: SECRET_LABEL }], ['search.query', { text: 'iPhone' }],
        ['notifications.list', {}], ['chats.list', {}], ['session.get', {}], ['users.list', {}], ['users.get', { id: 'usr_003' }],
        ['projects.list', { status: 'all' }], ['tasks.list', {}], ['dashboard.get', {}], ['settings.get', {}], ['agents.list', {}], ['users.invites', {}],
      ];
      for (const [name, input] of reads) {
        const text = JSON.stringify(await t.api.call(name as never, input as never).catch((e: unknown) => ({ error: (e as { code?: string }).code })));
        for (const mark of MARKS) expect(text, `${name} as ${userId}`).not.toContain(mark);
      }
    }
  });

  it('writes no event: the History holds no row for a device, so there is nothing to undo or to read', async () => {
    const t = await world();
    expect(Object.values(t.store.state.events).filter((event) => JSON.stringify(event).includes('pdv_') || event.targetType === ('pushDevice' as never))).toEqual([]);
    t.as('usr_001');
    const events = await t.api.call('events.list', { limit: 500 });
    expect(JSON.stringify(events)).not.toContain('SECRET');
    await expect(t.api.call('events.undo', { eventId: 'pdv_001' })).rejects.toBeTruthy();
  });

  it('lets no other person remove, move or read a device through push.remove or push.register', async () => {
    const t = await world();
    for (const userId of ['usr_001', 'usr_002', 'usr_004']) {
      t.as(userId);
      expect(await t.api.call('push.remove', { endpoint: SECRET_ENDPOINT }), userId).toEqual({ removed: false });
    }
    expect(Object.keys(t.store.state.pushDevices ?? {}).sort()).toEqual(['pdv_001', 'pdv_002']);
    // The one way to take an endpoint is to register it from that very browser. Then the first person loses it, and nobody else learns it.
    t.as('usr_004');
    const taken = await t.api.call('push.register', { endpoint: SECRET_ENDPOINT, label: 'Shared browser' });
    expect(Object.keys(taken).sort()).toEqual(['createdAt', 'endpoint', 'id', 'label']);
    t.as('usr_003');
    expect((await t.api.call('push.mine', {})).map((d) => d.endpoint)).toEqual([SECOND_ENDPOINT]);
  });

  it('gives an agent no way to learn or change a device: all three calls refuse it', async () => {
    const t = await world();
    t.as('usr_005');
    for (const [name, input] of [['push.mine', {}], ['push.remove', { endpoint: SECRET_ENDPOINT }], ['push.register', { endpoint: SECRET_ENDPOINT, label: 'x' }]] as const) {
      await expect(t.api.call(name, input as never), name).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(Object.keys(t.store.state.pushDevices ?? {})).toHaveLength(2);
  });

  it('keeps the push calls out of the History even for the Admin who turns push on', async () => {
    const t = await world();
    t.as('usr_001');
    const before = Object.keys(t.store.state.events).length;
    await t.api.call('push.register', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/admin', label: 'Firefox on Mac' });
    await t.api.call('push.remove', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/admin' });
    expect(Object.keys(t.store.state.events)).toHaveLength(before);
  });
});
