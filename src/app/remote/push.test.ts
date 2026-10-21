import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canAsk, deviceLabel, isPushOptedOut, keyBytes, readEnv, removeThisDevice, sameKey, setPushOptOut, statusOf, syncThisDevice, turnOff, turnOn,
  type PushApi, type PushEnv,
} from './push';

/**
 * The browser side of push (owner, 2026-10-08): the state of the Settings switch, the label of a device, and the steps to turn
 * push on and off. The browser objects (Notification, the service worker, the push manager) are made up here.
 */

// A made-up public key of the right size: the first byte is 4, as for every uncompressed P-256 point.
const KEY = `BA${'a'.repeat(85)}`;
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/sample-token';
// The keys that a browser gives with its subscription (owner, 2026-10-21): the server encrypts each push line with them.
const BROWSER_KEYS = { p256dh: `B${'p'.repeat(86)}`, auth: 'q'.repeat(22) };
const ME = 'usr_001';
const OTHER = 'usr_002';

const env =(more: Partial<PushEnv> = {}): PushEnv => ({
  hasNotification: true, hasWorker: true, hasManager: true, permission: 'default', iosBrowser: false, standalone: false, ...more,
});

describe('statusOf: what the switch shows', () => {
  it('is off when the browser can push, the key is set, and the person has not turned it on', () => {
    expect(statusOf(env(), KEY, false)).toBe('off');
  });

  it('is on when the permission is granted and this browser holds a subscription', () => {
    expect(statusOf(env({ permission: 'granted' }), KEY, true)).toBe('on');
    // A subscription without the permission cannot show anything, so the switch stays off.
    expect(statusOf(env({ permission: 'default' }), KEY, true)).toBe('off');
    expect(statusOf(env({ permission: 'granted' }), KEY, false)).toBe('off');
  });

  it('is blocked when the person denied the permission in the browser', () => {
    expect(statusOf(env({ permission: 'denied' }), KEY, false)).toBe('blocked');
    expect(statusOf(env({ permission: 'denied' }), KEY, true)).toBe('blocked');
  });

  it('is unsupported when the browser lacks the worker, the push manager or notifications', () => {
    for (const missing of ['hasWorker', 'hasManager', 'hasNotification'] as const) expect(statusOf(env({ [missing]: false }), KEY, false), missing).toBe('unsupported');
  });

  it('asks an iPhone or iPad in the browser to add Madar to the Home Screen first', () => {
    const tab = env({ iosBrowser: true, standalone: false, hasManager: false, hasNotification: false });
    expect(statusOf(tab, KEY, false)).toBe('needs_install');
    // From the Home Screen the same phone has the push manager.
    expect(statusOf(env({ iosBrowser: true, standalone: true }), KEY, false)).toBe('off');
    // An old iPhone in the Home Screen app, with no push manager, is just unsupported.
    expect(statusOf(env({ iosBrowser: true, standalone: true, hasManager: false }), KEY, false)).toBe('unsupported');
  });

  it('says not set up when the build has no public key', () => {
    expect(statusOf(env(), undefined, false)).toBe('not_set');
    expect(statusOf(env(), '', false)).toBe('not_set');
    // An unsupported browser says so before it says anything about the key.
    expect(statusOf(env({ hasManager: false }), undefined, false)).toBe('unsupported');
  });
});

describe('deviceLabel', () => {
  const label = (ua: string, platform = '', touch = 0) => deviceLabel(ua, platform, touch);

  it('names the browser and the system in short words', () => {
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'MacIntel')).toBe('Chrome on Mac');
    expect(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toBe('Edge on Windows');
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0', 'MacIntel')).toBe('Firefox on Mac');
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'MacIntel')).toBe('Safari on Mac');
    expect(label('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(label('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(label('Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/140.0.0.0 Mobile Safari/537.36')).toBe('Samsung Internet on Android');
    expect(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0')).toBe('Opera on Windows');
    expect(label('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')).toBe('Chrome on Linux');
  });

  it('knows an iPad that calls itself a Mac by its touch screen', () => {
    expect(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'MacIntel', 5)).toBe('Safari on iPad');
  });

  it('falls back to a plain word and stays short', () => {
    expect(label('')).toBe('Browser');
    expect(label('SomeBot/1.0')).toBe('Browser');
    expect(label('x'.repeat(500))).toBe('Browser');
  });
});

describe('keyBytes and sameKey', () => {
  it('turns the base64url key into its 65 bytes', () => {
    const bytes = keyBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it('compares the key of a subscription with the key of the build', () => {
    const same = { options: { applicationServerKey: keyBytes(KEY).buffer } } as unknown as PushSubscription;
    const other = { options: { applicationServerKey: keyBytes(`BA${'b'.repeat(85)}`).buffer } } as unknown as PushSubscription;
    const none = { options: { applicationServerKey: null } } as unknown as PushSubscription;
    expect(sameKey(same, KEY)).toBe(true);
    expect(sameKey(other, KEY)).toBe(false);
    expect(sameKey(none, KEY)).toBe(false);
  });
});

/** A made-up browser: a permission, a service worker with a push manager, and the calls that the code makes on them. */
function browser(o: { permission?: NotificationPermission; asked?: NotificationPermission; subscription?: PushSubscription | null; subscribeFails?: boolean } = {}) {
  let permission: NotificationPermission = o.permission ?? 'default';
  let current: PushSubscription | null = o.subscription ?? null;
  const steps: string[] = [];
  const subscription = (endpoint = ENDPOINT, key = KEY, keys: typeof BROWSER_KEYS | null = BROWSER_KEYS): PushSubscription => ({
    endpoint,
    options: { applicationServerKey: keyBytes(key).buffer },
    toJSON: () => (keys ? { endpoint, keys } : { endpoint }),
    unsubscribe: vi.fn(async () => {
      steps.push('unsubscribe');
      current = null;
      return true;
    }),
  } as unknown as PushSubscription);
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }) => {
      steps.push('subscribe');
      expect(options.userVisibleOnly).toBe(true);
      if (o.subscribeFails) throw new DOMException('Registration failed.', 'AbortError');
      current = subscription();
      return current;
    }),
  };
  const registration = { pushManager };
  const worker = {
    register: vi.fn(async () => {
      steps.push('register worker');
      return registration;
    }),
    ready: Promise.resolve(registration),
    getRegistration: vi.fn(async () => registration),
  };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission: vi.fn(async () => {
      steps.push('ask permission');
      permission = o.asked ?? 'granted';
      return permission;
    }),
  });
  return { steps, pushManager, worker, subscription, setCurrent: (value: PushSubscription | null) => { current = value; } };
}

function apiOf(o: { mine?: { endpoint: string; hasKeys?: boolean }[]; failRegister?: boolean; failRemove?: boolean } = {}) {
  const sent: [string, unknown][] = [];
  const api = {
    call: vi.fn(async (name: string, input: unknown) => {
      sent.push([name, input]);
      if (name === 'push.mine') return o.mine ?? [];
      if (name === 'push.register' && o.failRegister) throw new Error('The server said no.');
      if (name === 'push.remove' && o.failRemove) throw new Error('No network.');
      return name === 'push.remove' ? { removed: true } : { id: 'pdv_001' };
    }),
  } as unknown as PushApi;
  return { api, sent };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  localStorage.clear();
});

describe('readEnv', () => {
  it('reads what the browser offers and the permission', () => {
    browser({ permission: 'granted' });
    expect(readEnv()).toMatchObject({ hasNotification: true, hasWorker: true, hasManager: true, permission: 'granted', iosBrowser: false });
  });

  it('sees a browser with none of the three parts', () => {
    vi.stubGlobal('Notification', undefined);
    Reflect.deleteProperty(window, 'PushManager');
    expect(readEnv()).toMatchObject({ hasNotification: false, hasWorker: false, hasManager: false });
  });
});

describe('turnOn', () => {
  it('asks the permission first, then registers the worker, subscribes with the key, and saves the device', async () => {
    const b = browser();
    const { api, sent } = apiOf();
    expect(await turnOn(api, KEY)).toBe('on');
    expect(b.steps).toEqual(['ask permission', 'register worker', 'subscribe']);
    expect(b.worker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(sent).toEqual([['push.register', { endpoint: ENDPOINT, label: expect.any(String), keys: BROWSER_KEYS }]]);
    expect((sent[0][1] as { label: string }).label.length).toBeGreaterThan(0);
  });

  it('stops at once when the person denies the permission: no worker, no subscription, no call', async () => {
    const b = browser({ asked: 'denied' });
    const { api, sent } = apiOf();
    expect(await turnOn(api, KEY)).toBe('blocked');
    expect(b.steps).toEqual(['ask permission']);
    expect(sent).toEqual([]);
  });

  it('stops quietly when the person closes the question with no answer', async () => {
    const b = browser({ asked: 'default' });
    const { api, sent } = apiOf();
    expect(await turnOn(api, KEY)).toBe('dismissed');
    expect(b.steps).toEqual(['ask permission']);
    expect(sent).toEqual([]);
  });

  it('takes back the subscription when the server does not save the device, and passes the error on', async () => {
    const b = browser();
    const { api } = apiOf({ failRegister: true });
    await expect(turnOn(api, KEY)).rejects.toThrow('The server said no.');
    expect(b.steps).toEqual(['ask permission', 'register worker', 'subscribe', 'unsubscribe']);
  });

  it('passes the error on when the push service refuses the subscription', async () => {
    browser({ subscribeFails: true });
    const { api, sent } = apiOf();
    await expect(turnOn(api, KEY)).rejects.toThrow('Registration failed.');
    expect(sent).toEqual([]);
  });
});

describe('turnOff', () => {
  it('removes the device on the server and unsubscribes this browser', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription());
    const { api, sent } = apiOf();
    await turnOff(api);
    expect(b.steps).toEqual(['unsubscribe']);
    expect(sent).toEqual([['push.remove', { endpoint: ENDPOINT }]]);
  });

  it('is done when the server cannot be reached: the browser has no subscription any more', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription());
    const { api } = apiOf({ failRemove: true });
    await expect(turnOff(api)).resolves.toBeUndefined();
    expect(b.steps).toEqual(['unsubscribe']);
  });

  it('does nothing when this browser holds no subscription', async () => {
    browser({ permission: 'granted' });
    const { api, sent } = apiOf();
    await turnOff(api);
    expect(sent).toEqual([]);
  });
});

describe('syncThisDevice: the check at the start of the app', () => {
  it('does nothing without the permission, even when the browser holds a subscription', async () => {
    const b = browser({ permission: 'default' });
    b.setCurrent(b.subscription());
    const none = apiOf();
    expect(await syncThisDevice(none.api, KEY, ME)).toBe('none');
    expect(none.sent).toEqual([]);
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    expect(await syncThisDevice(none.api, KEY, ME)).toBe('none');
    expect(none.sent).toEqual([]);
  });

  it('does nothing more when the server already lists this endpoint', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription());
    const { api, sent } = apiOf({ mine: [{ endpoint: ENDPOINT, hasKeys: true }] });
    expect(await syncThisDevice(api, KEY, ME)).toBe('same');
    expect(sent).toEqual([['push.mine', {}]]);
  });

  // A device saved before 2026-10-21 has no keys on the server: the first start of the app after the release sends them.
  it('registers the endpoint again with the keys when the server lists it without keys', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription());
    const { api, sent } = apiOf({ mine: [{ endpoint: ENDPOINT, hasKeys: false }] });
    expect(await syncThisDevice(api, KEY, ME)).toBe('registered');
    expect(sent).toEqual([['push.mine', {}], ['push.register', { endpoint: ENDPOINT, label: expect.any(String), keys: BROWSER_KEYS }]]);
  });

  it('does not register again and again when the browser gives no keys', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription(ENDPOINT, KEY, null));
    const { api, sent } = apiOf({ mine: [{ endpoint: ENDPOINT, hasKeys: false }] });
    expect(await syncThisDevice(api, KEY, ME)).toBe('same');
    expect(sent).toEqual([['push.mine', {}]]);
  });

  it('registers the endpoint again when the server does not list it (the browser renewed it)', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription('https://fcm.googleapis.com/fcm/send/renewed-token'));
    const { api, sent } = apiOf({ mine: [{ endpoint: ENDPOINT }] });
    expect(await syncThisDevice(api, KEY, ME)).toBe('registered');
    expect(sent.map(([name]) => name)).toEqual(['push.mine', 'push.register']);
    expect(sent[1][1]).toMatchObject({ endpoint: 'https://fcm.googleapis.com/fcm/send/renewed-token' });
  });

  it('subscribes again with the new key when the key of the build changed, then registers the new endpoint', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription(ENDPOINT, `BA${'b'.repeat(85)}`));
    const { api, sent } = apiOf({ mine: [] });
    expect(await syncThisDevice(api, KEY, ME)).toBe('registered');
    expect(b.steps).toEqual(['unsubscribe', 'subscribe']);
    expect(sent.map(([name]) => name)).toEqual(['push.mine', 'push.register']);
  });

  // Default on (owner, 2026-10-09): the permission lasts in the browser, so the next sign-in needs no new question.
  it('turns push on by itself when the permission is granted and the browser holds no subscription', async () => {
    const b = browser({ permission: 'granted' });
    const { api, sent } = apiOf();
    expect(await syncThisDevice(api, KEY, ME)).toBe('registered');
    expect(b.steps).toEqual(['register worker', 'subscribe']);
    expect(sent).toEqual([['push.register', { endpoint: ENDPOINT, label: expect.any(String), keys: BROWSER_KEYS }]]);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('stays off when this person turned push off on this browser', async () => {
    const b = browser({ permission: 'granted' });
    setPushOptOut(ME, true);
    const { api, sent } = apiOf();
    expect(await syncThisDevice(api, KEY, ME)).toBe('none');
    expect(b.steps).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('does not bind the next person on the same browser to the choice of the first', async () => {
    const b = browser({ permission: 'granted' });
    setPushOptOut(ME, true);
    const { api, sent } = apiOf();
    expect(await syncThisDevice(api, KEY, OTHER)).toBe('registered');
    expect(b.steps).toEqual(['register worker', 'subscribe']);
    expect(sent.map(([name]) => name)).toEqual(['push.register']);
  });

  it('takes back the new subscription when the server does not save the device, and passes the error on', async () => {
    const b = browser({ permission: 'granted' });
    const { api } = apiOf({ failRegister: true });
    await expect(syncThisDevice(api, KEY, ME)).rejects.toThrow('The server said no.');
    expect(b.steps).toEqual(['register worker', 'subscribe', 'unsubscribe']);
  });

  it('does nothing in a browser with a permission but no push manager', async () => {
    browser({ permission: 'granted' });
    Reflect.deleteProperty(window, 'PushManager');
    const { api, sent } = apiOf();
    expect(await syncThisDevice(api, KEY, ME)).toBe('none');
    expect(sent).toEqual([]);
  });
});

describe('the choice to stay off, kept on this browser for each person', () => {
  it('is not set at first, and is kept for one person only', () => {
    expect(isPushOptedOut(ME)).toBe(false);
    setPushOptOut(ME, true);
    expect(isPushOptedOut(ME)).toBe(true);
    expect(isPushOptedOut(OTHER)).toBe(false);
    setPushOptOut(ME, false);
    expect(isPushOptedOut(ME)).toBe(false);
  });

  it('reads as not set, and never throws, when the browser keeps no storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('No storage.'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('No storage.'); });
    expect(isPushOptedOut(ME)).toBe(false);
    expect(() => setPushOptOut(ME, true)).not.toThrow();
  });
});

describe('canAsk: when Madar shows its one ask on Home', () => {
  it('is true when the browser can push, the key is set, and the person was never asked', () => {
    expect(canAsk(env(), KEY, false)).toBe(true);
  });

  it('is false after any answer, and after the person turned push off', () => {
    expect(canAsk(env({ permission: 'granted' }), KEY, false)).toBe(false);
    expect(canAsk(env({ permission: 'denied' }), KEY, false)).toBe(false);
    expect(canAsk(env(), KEY, true)).toBe(false);
  });

  it('is false where the switch has a note in place of a control', () => {
    expect(canAsk(env({ hasManager: false }), KEY, false)).toBe(false);
    expect(canAsk(env({ iosBrowser: true, hasManager: false, hasNotification: false }), KEY, false)).toBe(false);
    expect(canAsk(env(), undefined, false)).toBe(false);
  });
});

describe('removeThisDevice: the step before sign out', () => {
  it('removes the device on the server and unsubscribes this browser, so the next person on it gets no push', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription());
    const { api, sent } = apiOf();
    await removeThisDevice(api);
    expect(sent).toEqual([['push.remove', { endpoint: ENDPOINT }]]);
    expect(b.steps).toEqual(['unsubscribe']);
  });

  it('still unsubscribes when the server does not answer, and never throws', async () => {
    const b = browser({ permission: 'granted' });
    b.setCurrent(b.subscription());
    const { api } = apiOf({ failRemove: true });
    await expect(removeThisDevice(api)).resolves.toBeUndefined();
    expect(b.steps).toEqual(['unsubscribe']);
  });

  it('does nothing in a browser without push', async () => {
    vi.stubGlobal('Notification', undefined);
    Reflect.deleteProperty(navigator, 'serviceWorker');
    const { api, sent } = apiOf();
    await expect(removeThisDevice(api)).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });
});
