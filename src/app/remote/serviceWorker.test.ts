import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { pushWords } from '../../test/pushBrowser';

/**
 * public/sw.js (owner, 2026-10-08): plain JavaScript with no build step. The test runs the file in a clean context with a made-up
 * `self`, as a browser runs a service worker: it keeps the listeners, then fires a push and a press on the notification.
 */

const source = readFileSync('public/sw.js', 'utf8');

type Listener = (event: Record<string, unknown>) => void;
type Client = { url: string; focus: ReturnType<typeof vi.fn>; visibilityState?: string; focused?: boolean };

function load(o: { language?: string; clients?: Client[]; userAgent?: string; matchAll?: () => Promise<Client[]> } = {}) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    navigator: { language: o.language ?? 'en-US', ...(o.userAgent === undefined ? {} : { userAgent: o.userAgent }) },
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    registration: { showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => void shown.push({ title, options })) },
    clients: {
      matchAll: vi.fn(o.matchAll ?? (async () => o.clients ?? [])),
      openWindow: vi.fn(async (url: string) => void opened.push(url)),
      claim: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
  };
  const context = vm.createContext({ self, Promise, String });
  vm.runInContext(source, context);
  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (work: Promise<unknown>) => void waits.push(work) });
    await Promise.all(waits);
    return waits.length;
  };
  return { self, listeners, shown, opened, fire, context };
}

describe('public/sw.js: the text of the push', () => {
  it('shows the fixed English line and the title Madar for an English browser', async () => {
    const worker = load({ language: 'en-GB' });
    await worker.fire('push');
    expect(worker.shown).toEqual([{ title: 'Madar', options: expect.objectContaining({ body: 'You have something new in Madar.' }) }]);
  });

  it('shows the fixed Arabic line and the title مدار for a browser whose language starts with ar', async () => {
    for (const language of ['ar', 'ar-SA', 'AR-sa']) {
      const worker = load({ language });
      await worker.fire('push');
      expect(worker.shown).toEqual([{ title: 'مدار', options: expect.objectContaining({ body: 'لديك جديد في مدار.' }) }]);
      expect(worker.shown[0].options).toMatchObject({ lang: 'ar', dir: 'rtl' });
    }
  });

  it('shows English when the language is missing or is not Arabic', async () => {
    for (const language of ['', 'fr-FR', 'en']) {
      const worker = load({ language });
      await worker.fire('push');
      expect(worker.shown[0].options.body).toBe('You have something new in Madar.');
    }
    const worker = load();
    (worker.self.navigator as { language?: string }).language = undefined;
    await worker.fire('push');
    expect(worker.shown[0].title).toBe('Madar');
  });

  it('keeps the same two lines as the word files, so the worker and the screens say the same', () => {
    const worker = load();
    const pushText = vm.runInContext('pushText', worker.context) as (language: string) => { title: string; body: string };
    expect(pushText('en')).toEqual({ title: pushWords.en.notificationTitle, body: pushWords.en.notificationBody });
    expect(pushText('ar')).toEqual({ title: pushWords.ar.notificationTitle, body: pushWords.ar.notificationBody });
  });

  it('carries no task, project, client or person: the worker never reads the data of the push', async () => {
    const worker = load();
    await worker.fire('push', { data: { json: () => { throw new Error('The worker read the data.'); }, text: () => { throw new Error('The worker read the data.'); } } });
    expect(worker.shown).toHaveLength(1);
    expect(source).not.toMatch(/event\.data/);
  });
});

describe('public/sw.js: the notification', () => {
  it('shows exactly one notification for each push, with a fixed tag that renotifies and the Madar icon', async () => {
    const worker = load();
    expect(await worker.fire('push')).toBe(1);
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].options).toMatchObject({ tag: 'madar-new', renotify: true, icon: '/icons/madar-192.png' });
    await worker.fire('push');
    expect(worker.shown).toHaveLength(2);
    expect(worker.shown[1].options.tag).toBe('madar-new');
  });

  it('closes the notification on a press, and focuses an open Madar window', async () => {
    const focus = vi.fn(async () => undefined);
    const worker = load({ clients: [{ url: 'https://madar.vado.sa/projects', focus }] });
    const close = vi.fn();
    await worker.fire('notificationclick', { notification: { close } });
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(worker.opened).toEqual([]);
  });

  it('opens the home address when no Madar window is open', async () => {
    const worker = load({ clients: [] });
    const close = vi.fn();
    await worker.fire('notificationclick', { notification: { close } });
    expect(close).toHaveBeenCalledOnce();
    expect(worker.opened).toEqual(['/']);
  });

  it('asks for the windows of the site, also the ones that this worker does not control yet', async () => {
    const worker = load();
    await worker.fire('notificationclick', { notification: { close: vi.fn() } });
    expect(worker.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });
});

describe('public/sw.js: the shape of the file', () => {
  it('takes over at once on a new version, and never handles fetch, so it cannot break a page', async () => {
    const worker = load();
    expect([...worker.listeners.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
    await worker.fire('install');
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    await worker.fire('activate');
    expect(worker.self.clients.claim).toHaveBeenCalled();
    expect(source).not.toMatch(/['"]fetch['"]/);
  });

  it('holds no em-dash and no network address', () => {
    expect(source).not.toContain('\u2014');
    expect(source).not.toMatch(/https?:\/\//);
  });
});

/**
 * A push for a person who looks at Madar (fbk_028, owner 2026-10-23). The push has no data, so the worker cannot tell a chat message from
 * a notice. A window of Madar that is visible and has the focus already shows the new thing in the page, so a desktop notice on top is
 * noise. WebKit (Safari on a Mac, every browser on an iPhone) revokes the subscription of a site that gets a push and shows no notice,
 * so there the worker always shows it. Only an engine that is known to allow it (Chromium) may stay silent.
 */
const UA = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromePhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  firefoxPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
};
const front = (): Client => ({ url: 'https://madar.vado.sa/inbox/cnv_001', focus: vi.fn(), visibilityState: 'visible', focused: true });

describe('public/sw.js: no notice for a person who looks at Madar', () => {
  it('shows nothing when a window of Madar is visible and has the focus, in Chromium', async () => {
    for (const userAgent of [UA.chrome, UA.edge, UA.androidChrome]) {
      const worker = load({ userAgent, clients: [front()] });
      expect(await worker.fire('push')).toBe(1);
      expect(worker.shown, userAgent).toEqual([]);
    }
  });

  it('shows the notice when no window of Madar is in front', async () => {
    const cases: Record<string, Client[]> = {
      'no window': [],
      'a hidden window': [{ ...front(), visibilityState: 'hidden' }],
      'a visible window without the focus': [{ ...front(), focused: false }],
      'a window that reports nothing': [{ url: 'https://madar.vado.sa/', focus: vi.fn() }],
    };
    for (const [name, clients] of Object.entries(cases)) {
      const worker = load({ userAgent: UA.chrome, clients });
      await worker.fire('push');
      expect(worker.shown, name).toHaveLength(1);
    }
  });

  it('shows the notice when one of several windows is not in front, and stays silent when any window is in front', async () => {
    const back = { ...front(), focused: false };
    const quiet = load({ userAgent: UA.chrome, clients: [back, front()] });
    await quiet.fire('push');
    expect(quiet.shown).toEqual([]);
    const loud = load({ userAgent: UA.chrome, clients: [back, { ...back, visibilityState: 'hidden' }] });
    await loud.fire('push');
    expect(loud.shown).toHaveLength(1);
  });

  it('always shows the notice in WebKit, also when a window of Madar is in front: a push with no notice revokes the subscription', async () => {
    for (const userAgent of [UA.safariMac, UA.safariPhone, UA.chromePhone, UA.firefoxPhone]) {
      const worker = load({ userAgent, clients: [front()] });
      await worker.fire('push');
      expect(worker.shown, userAgent).toHaveLength(1);
      // WebKit does not even wait for the list of windows: the notice is the first thing the worker does.
      expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
    }
  });

  it('shows the notice when the engine is not known (Firefox is one of them: its rule for a push with no notice is not proven), or the browser gives no user agent', async () => {
    for (const userAgent of [undefined, '', 'SomeNewBrowser/1.0', UA.firefox]) {
      const worker = load({ ...(userAgent === undefined ? {} : { userAgent }), clients: [front()] });
      await worker.fire('push');
      expect(worker.shown, String(userAgent)).toHaveLength(1);
    }
  });

  it('shows the notice when the list of windows cannot be read', async () => {
    const worker = load({ userAgent: UA.chrome, matchAll: () => Promise.reject(new Error('No windows.')) });
    await worker.fire('push');
    expect(worker.shown).toHaveLength(1);
  });

  it('asks for the windows of the site, also the ones that this worker does not control yet', async () => {
    const worker = load({ userAgent: UA.chrome });
    await worker.fire('push');
    expect(worker.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });
});
