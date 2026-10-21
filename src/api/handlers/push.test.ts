import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { PUSH_DEVICES_PER_PERSON, PUSH_ENDPOINT_MAX, PUSH_LABEL_MAX, isPushEndpoint } from '../contract/push';
import { setNow } from '../../lib/dates';
import { NOW, makeUser, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/** The world has Hala (Admin, usr_001), Faisal (usr_002), Sara (usr_003), Omar (usr_004) and Sara's agent (usr_005). */
const FCM = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bE-sample-token-1';
const MOZILLA = 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABsample';
const APPLE = 'https://web.push.apple.com/QGsampletoken';

const world = () => testApi(calls);
const devicesOf = (t: ReturnType<typeof world>) => Object.values(t.store.state.pushDevices ?? {});

describe('push.register (owner, 2026-10-08)', () => {
  it('saves one device for the person and gives back its id, label, endpoint and day', async () => {
    const t = world();
    t.as('usr_003');
    const device = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    expect(device).toMatchObject({ id: 'pdv_001', endpoint: FCM, label: 'Chrome on Mac' });
    expect(devicesOf(t)).toEqual([expect.objectContaining({ id: 'pdv_001', userId: 'usr_003', endpoint: FCM, label: 'Chrome on Mac', lastPushAt: null })]);
    // The view of the device holds nothing of the person, and never its keys: only whether it has them.
    expect(Object.keys(device).sort()).toEqual(['createdAt', 'endpoint', 'hasKeys', 'id', 'label']);
    expect(device.hasKeys).toBe(false);
  });

  it('keeps one row for one endpoint: the same person registering again changes the label only', async () => {
    const t = world();
    t.as('usr_003');
    const first = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    const again = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Windows' });
    expect(again).toMatchObject({ id: first.id, createdAt: first.createdAt, label: 'Chrome on Windows' });
    expect(devicesOf(t)).toHaveLength(1);
  });

  it('moves an endpoint to the current person when another person held it (a shared browser)', async () => {
    const t = world();
    t.as('usr_003');
    const sara = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    t.store.state.pushDevices![sara.id].lastPushAt = '2026-09-29T09:00:00.000+03:00';
    t.as('usr_004');
    const omar = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    expect(omar.id).toBe(sara.id);
    expect(devicesOf(t)).toEqual([expect.objectContaining({ id: sara.id, userId: 'usr_004', lastPushAt: null })]);
    t.as('usr_003');
    expect(await t.api.call('push.mine', {})).toEqual([]);
    t.as('usr_004');
    expect(await t.api.call('push.mine', {})).toHaveLength(1);
  });

  it('keeps at most 10 devices for a person: the oldest one goes, never the new one', async () => {
    const t = world();
    t.as('usr_003');
    for (let i = 1; i <= PUSH_DEVICES_PER_PERSON; i += 1) await t.api.call('push.register', { endpoint: `${FCM}-${i}`, label: `Device ${i}` });
    expect(await t.api.call('push.mine', {})).toHaveLength(PUSH_DEVICES_PER_PERSON);
    const newest = await t.api.call('push.register', { endpoint: `${FCM}-new`, label: 'Newest' });
    const mine = await t.api.call('push.mine', {});
    expect(mine).toHaveLength(PUSH_DEVICES_PER_PERSON);
    expect(mine.map((d) => d.endpoint)).not.toContain(`${FCM}-1`);
    expect(mine.map((d) => d.endpoint)).toContain(`${FCM}-2`);
    expect(mine.at(-1)).toMatchObject({ id: newest.id, endpoint: `${FCM}-new` });
  });

  it('does not count the devices of other people against the cap', async () => {
    const t = world();
    t.as('usr_004');
    for (let i = 1; i <= PUSH_DEVICES_PER_PERSON; i += 1) await t.api.call('push.register', { endpoint: `${MOZILLA}-${i}`, label: `Device ${i}` });
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    t.as('usr_004');
    expect(await t.api.call('push.mine', {})).toHaveLength(PUSH_DEVICES_PER_PERSON);
  });

  it('writes no event, no notice and no message', async () => {
    const t = world();
    const before = { events: Object.keys(t.store.state.events).length, notices: Object.keys(t.store.state.notifications).length, messages: Object.keys(t.store.state.messages).length };
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Windows' });
    await t.api.call('push.remove', { endpoint: FCM });
    expect({ events: Object.keys(t.store.state.events).length, notices: Object.keys(t.store.state.notifications).length, messages: Object.keys(t.store.state.messages).length }).toEqual(before);
  });

  it('refuses an agent: a device belongs to a person', async () => {
    const t = world();
    t.as('usr_005');
    await expect(t.api.call('push.register', { endpoint: FCM, label: 'Agent' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('push.mine', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('push.remove', { endpoint: FCM })).rejects.toMatchObject({ code: 'forbidden' });
    expect(devicesOf(t)).toEqual([]);
  });

  it('refuses an endpoint that is not the https address of a known push service', async () => {
    const t = world();
    t.as('usr_003');
    const bad = [
      'http://fcm.googleapis.com/fcm/send/x', // not https
      'https://169.254.169.254/latest/meta-data', // an address inside a cloud network
      'https://localhost/x',
      'https://evil.example/push', // not a push service
      'https://fcm.googleapis.com.evil.example/x', // a look-alike host
      'https://user:pass@fcm.googleapis.com/fcm/send/x', // a login in the address
      'https://fcm.googleapis.com:8443/fcm/send/x', // another port
      'not a url',
      '',
    ];
    for (const endpoint of bad) await expect(t.api.call('push.register', { endpoint, label: 'x' }), endpoint).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('push.register', { endpoint: `${FCM}${'a'.repeat(PUSH_ENDPOINT_MAX)}`, label: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(devicesOf(t)).toEqual([]);
  });

  it('takes the addresses of the four push services of the browsers', () => {
    for (const endpoint of [
      FCM, MOZILLA, APPLE,
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
      'https://fcm.googleapis.com/wp/sample-token',
    ]) expect(isPushEndpoint(endpoint), endpoint).toBe(true);
    for (const endpoint of ['https://notify.windows.com.evil.example/w', 'https://push.apple.com.evil.example/x', 'ftp://fcm.googleapis.com/x']) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('trims the label, refuses an empty one and one over the limit', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('push.register', { endpoint: FCM, label: '  Safari on iPhone  ' })).label).toBe('Safari on iPhone');
    await expect(t.api.call('push.register', { endpoint: MOZILLA, label: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('push.register', { endpoint: MOZILLA, label: 'x'.repeat(PUSH_LABEL_MAX + 1) })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a person who is turned off', async () => {
    const t = world();
    t.store.state.users.usr_004 = makeUser('usr_004', { ...t.store.state.users.usr_004, active: false });
    t.as('usr_004');
    await expect(t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' })).rejects.toBeTruthy();
    expect(devicesOf(t)).toEqual([]);
  });
});

// The keys of the browser (owner, 2026-10-21): the server encrypts the line of each push for this browser only (RFC 8291).
// p256dh is a P-256 public key (65 bytes, 87 characters), auth a secret of 16 bytes (22 characters), both in base64url.
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'C'.repeat(22) };
const OTHER_KEYS = { p256dh: `B${'D'.repeat(86)}`, auth: 'E'.repeat(22) };

describe('push.register with the keys of the browser (owner, 2026-10-21)', () => {
  it('keeps the keys in the record, and the view tells only that it has them', async () => {
    const t = world();
    t.as('usr_003');
    const device = await t.api.call('push.register', { endpoint: APPLE, label: 'Safari on iPhone', keys: KEYS });
    expect(device.hasKeys).toBe(true);
    expect(JSON.stringify(device)).not.toContain(KEYS.auth);
    expect(devicesOf(t)).toEqual([expect.objectContaining({ endpoint: APPLE, keys: KEYS })]);
    expect(await t.api.call('push.mine', {})).toEqual([expect.objectContaining({ endpoint: APPLE, hasKeys: true })]);
    expect(JSON.stringify(await t.api.call('push.mine', {}))).not.toContain(KEYS.p256dh);
  });

  it('keeps the old keys when the same browser registers again without them, and takes new ones when it sends them', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: APPLE, label: 'Safari on iPhone', keys: KEYS });
    await t.api.call('push.register', { endpoint: APPLE, label: 'Safari on iPhone' });
    expect(devicesOf(t)[0].keys).toEqual(KEYS);
    await t.api.call('push.register', { endpoint: APPLE, label: 'Safari on iPhone', keys: OTHER_KEYS });
    expect(devicesOf(t)[0].keys).toEqual(OTHER_KEYS);
  });

  it('gives a device with no keys its keys when the browser sends them later (a device saved before 2026-10-21)', async () => {
    const t = world();
    t.as('usr_003');
    const old = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Android' });
    expect(old.hasKeys).toBe(false);
    const again = await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Android', keys: KEYS });
    expect(again).toMatchObject({ id: old.id, hasKeys: true });
  });

  it('takes keys with base64 padding and keeps them without it', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac', keys: { p256dh: `${KEYS.p256dh}=`, auth: `${KEYS.auth}==` } });
    expect(devicesOf(t)[0].keys).toEqual(KEYS);
  });

  it('refuses keys of the wrong form', async () => {
    const t = world();
    t.as('usr_003');
    for (const keys of [{ p256dh: KEYS.auth, auth: KEYS.auth }, { p256dh: KEYS.p256dh, auth: KEYS.p256dh }, { p256dh: `${KEYS.p256dh.slice(1)}+`, auth: KEYS.auth }]) {
      await expect(t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac', keys }), JSON.stringify(keys)).rejects.toBeTruthy();
    }
    expect(devicesOf(t)).toEqual([]);
  });

  it('moves the keys with a shared browser to the person who registers it', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac', keys: KEYS });
    t.as('usr_004');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac', keys: OTHER_KEYS });
    expect(devicesOf(t)).toEqual([expect.objectContaining({ userId: 'usr_004', keys: OTHER_KEYS })]);
  });
});

describe('push.remove', () => {
  it('removes the device of the person and says so', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    await t.api.call('push.register', { endpoint: MOZILLA, label: 'Firefox on Mac' });
    expect(await t.api.call('push.remove', { endpoint: FCM })).toEqual({ removed: true });
    expect((await t.api.call('push.mine', {})).map((d) => d.endpoint)).toEqual([MOZILLA]);
    expect(await t.api.call('push.remove', { endpoint: FCM })).toEqual({ removed: false });
  });

  it('never removes the device of another person, and answers as if the device was missing', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    for (const userId of ['usr_001', 'usr_004']) {
      t.as(userId);
      expect(await t.api.call('push.remove', { endpoint: FCM }), userId).toEqual({ removed: false });
      expect(await t.api.call('push.remove', { endpoint: APPLE }), userId).toEqual({ removed: false });
    }
    expect(devicesOf(t)).toHaveLength(1);
  });
});

describe('push.mine', () => {
  it('lists only the own devices, oldest first', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    t.as('usr_004');
    await t.api.call('push.register', { endpoint: MOZILLA, label: 'Firefox on Mac' });
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: APPLE, label: 'Safari on iPhone' });
    expect((await t.api.call('push.mine', {})).map((d) => d.label)).toEqual(['Chrome on Mac', 'Safari on iPhone']);
  });

  it('shows the Admin nothing of the devices of other people', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('push.register', { endpoint: FCM, label: 'Chrome on Mac' });
    t.as('usr_001');
    expect(await t.api.call('push.mine', {})).toEqual([]);
  });
});
