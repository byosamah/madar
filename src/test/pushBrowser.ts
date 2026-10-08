import { vi } from 'vitest';
import { keyBytes } from '../app/remote/push';
import { ar, en } from '../i18n/trees';

/**
 * A made-up browser for the push tests (owner, 2026-10-08): a Notification with a permission, a service worker with a push manager,
 * and a subscription. A test calls stop() in afterEach. The key is 65 bytes with the first byte 4, as a real P-256 public key.
 */
export const PUSH_TEST_KEY = `BA${'a'.repeat(85)}`;
export const PUSH_TEST_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/sample-token';

export type PushBrowserOptions = {
  permission?: NotificationPermission;
  /** The answer of the permission question. */
  asked?: NotificationPermission;
  subscribed?: boolean;
  subscribeFails?: boolean;
  /** A browser with no Notification, no worker and no push manager. */
  none?: boolean;
};

export function pushBrowser(o: PushBrowserOptions = {}) {
  if (o.none) {
    vi.stubGlobal('Notification', undefined);
    return { requestPermission: vi.fn(), unsubscribe: vi.fn(), subscribe: vi.fn() };
  }
  let permission: NotificationPermission = o.permission ?? 'default';
  let current: PushSubscription | null = null;
  const unsubscribe = vi.fn(async () => {
    current = null;
    return true;
  });
  const make = (): PushSubscription => ({
    endpoint: PUSH_TEST_ENDPOINT, options: { applicationServerKey: keyBytes(PUSH_TEST_KEY).buffer }, unsubscribe,
  } as unknown as PushSubscription);
  if (o.subscribed) current = make();
  const subscribe = vi.fn(async () => {
    if (o.subscribeFails) throw new DOMException('Registration failed.', 'AbortError');
    current = make();
    return current;
  });
  const registration = { pushManager: { getSubscription: async () => current, subscribe } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn(async () => registration), ready: Promise.resolve(registration), getRegistration: async () => registration },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  const requestPermission = vi.fn(async () => {
    permission = o.asked ?? 'granted';
    return permission;
  });
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission,
  });
  return { requestPermission, unsubscribe, subscribe };
}

/** Puts the browser globals back. Call it in afterEach, next to vi.unstubAllGlobals(). */
export function stopPushBrowser(): void {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'userAgent');
}

/** The user agent of an iPhone in Safari: no push in a browser tab. */
export function iphoneBrowser(): void {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
}

/** The push words of both languages. The track files are not in the type of the base file, so the tests read them through this. */
export const pushWords = {
  en: (en as unknown as { push: Record<string, string> }).push,
  ar: (ar as unknown as { push: Record<string, string> }).push,
};
