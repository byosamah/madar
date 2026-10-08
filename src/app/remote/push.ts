/**
 * Browser push, the page side (owner, 2026-10-08). The real build only. This file holds no React and no zod, so the sign-out step
 * of the first load can use it.
 *
 * The steps to turn push on: ask the permission (inside the click, first), register the worker (public/sw.js), subscribe with the
 * public VAPID key, and save the push address with push.register. The steps to turn it off: remove the device on the server,
 * unsubscribe the browser. The push address (endpoint) belongs to the browser, so the check at the start of the app saves it again
 * when the browser renewed it. A sign-out also unsubscribes this browser, so the next person on a shared browser gets no push.
 */

export type PushStatus = 'unsupported' | 'needs_install' | 'not_set' | 'blocked' | 'off' | 'on';

/** The calls of push that this file makes. The api of the runtime has them. */
export interface PushApi {
  call(name: string, input: unknown): Promise<unknown>;
}

/** What the browser offers right now. */
export type PushEnv = {
  hasNotification: boolean;
  hasWorker: boolean;
  hasManager: boolean;
  permission: NotificationPermission;
  /** An iPhone or iPad. Safari there has push only for a web app on the Home Screen. */
  iosBrowser: boolean;
  /** Madar runs from the Home Screen. */
  standalone: boolean;
};

/** The public VAPID key of this build (config/remote.<env>.env), or nothing. */
export function buildKey(): string | undefined {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY || undefined;
}

export function readEnv(win: Window = window): PushEnv {
  const nav = win.navigator;
  const notification = (win as unknown as { Notification?: { permission: NotificationPermission } }).Notification;
  const hasNotification = notification !== undefined;
  return {
    hasNotification,
    hasWorker: 'serviceWorker' in nav,
    hasManager: 'PushManager' in win && typeof (win as unknown as { PushManager?: unknown }).PushManager !== 'undefined',
    permission: notification ? notification.permission : 'default',
    iosBrowser: /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1),
    standalone: (nav as { standalone?: boolean }).standalone === true || (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches),
  };
}

/** What the Settings switch shows. subscribed: this browser holds a push subscription. */
export function statusOf(env: PushEnv, key: string | undefined, subscribed: boolean): PushStatus {
  if (!env.hasNotification || !env.hasWorker || !env.hasManager) return env.iosBrowser && !env.standalone ? 'needs_install' : 'unsupported';
  if (!key) return 'not_set';
  if (env.permission === 'denied') return 'blocked';
  return env.permission === 'granted' && subscribed ? 'on' : 'off';
}

/** A short name for this browser and system, for the device row: "Chrome on Mac". It is not a word of the screens. */
export function deviceLabel(userAgent: string, platform = '', touchPoints = 0): string {
  const ua = userAgent.length > 400 ? '' : userAgent;
  const ipad = /iPad/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  const system = /iPhone|iPod/.test(ua) ? 'iPhone' : ipad ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux|X11/.test(ua) ? 'Linux' : null;
  const browser = /Edg(A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari' : null;
  if (!browser && !system) return 'Browser';
  return system ? `${browser ?? 'Browser'} on ${system}` : browser!;
}

export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** True when the subscription was made with this public key. */
export function sameKey(subscription: PushSubscription, key: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(key);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const labelOfThisDevice = (): string => deviceLabel(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

/** Registers the worker, with the whole site as its scope, and waits until it is ready. */
async function registerWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** The subscription of this browser, or nothing. */
async function thisSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** A subscription with this key on this registration. An old one with another key goes first: the browser refuses two. */
async function subscribeOn(registration: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing, key)) return existing;
  if (existing) await existing.unsubscribe();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
}

/** True when this browser holds a push subscription. It never throws. */
export async function isSubscribed(): Promise<boolean> {
  try {
    return (await thisSubscription()) !== null;
  } catch {
    return false;
  }
}

/**
 * Turns push on for this browser. Call it in the click handler of the switch: the permission question must start inside the
 * click, before any other wait (Safari refuses it otherwise). An error from the browser or the server is passed on, after the
 * subscription is taken back when the server did not save the device.
 */
export async function turnOn(api: PushApi, key: string): Promise<'on' | 'blocked' | 'dismissed'> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'dismissed';
  const subscription = await subscribeOn(await registerWorker(), key);
  try {
    await api.call('push.register', { endpoint: subscription.endpoint, label: labelOfThisDevice() });
  } catch (error) {
    await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }
  return 'on';
}

/** Removes the device on the server (best effort), then unsubscribes this browser. An error of the browser is passed on. */
export async function turnOff(api: PushApi): Promise<void> {
  const subscription = await thisSubscription();
  if (!subscription) return;
  await api.call('push.remove', { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe();
}

/**
 * The check at the start of the app, for a person who is signed in. A browser that holds a subscription and has the permission
 * gets its endpoint saved again when the server does not list it (the browser renewed it). A subscription made with another key
 * (the keys changed) is made again with the key of this build.
 */
export async function syncThisDevice(api: PushApi, key: string): Promise<'none' | 'same' | 'registered'> {
  if (!readEnv().hasNotification || Notification.permission !== 'granted') return 'none';
  const registration = await navigator.serviceWorker.getRegistration();
  const found = registration ? await registration.pushManager.getSubscription() : null;
  if (!registration || !found) return 'none';
  const subscription = sameKey(found, key) ? found : await subscribeOn(registration, key);
  const mine = (await api.call('push.mine', {})) as { endpoint: string }[];
  if (mine.some((device) => device.endpoint === subscription.endpoint)) return 'same';
  await api.call('push.register', { endpoint: subscription.endpoint, label: labelOfThisDevice() });
  return 'registered';
}

/** The sign-out takes at most this long for push. A slow network never holds the person at the door. */
const LEAVE_WAIT_MS = 4_000;

/**
 * The step before sign out: remove this device on the server while the session still lives, and unsubscribe this browser. The next
 * person on a shared browser then gets no push and must turn it on. It never throws and never waits long.
 */
export async function removeThisDevice(api: PushApi): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    if (!readEnv().hasWorker) return;
    const subscription = await thisSubscription();
    if (!subscription) return;
    await api.call('push.remove', { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, LEAVE_WAIT_MS); })]);
  clearTimeout(timer);
}
