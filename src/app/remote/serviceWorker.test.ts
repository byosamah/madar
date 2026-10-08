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
type Client = { url: string; focus: ReturnType<typeof vi.fn> };

function load(o: { language?: string; clients?: Client[] } = {}) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    navigator: { language: o.language ?? 'en-US' },
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    registration: { showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => void shown.push({ title, options })) },
    clients: {
      matchAll: vi.fn(async () => o.clients ?? []),
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
    expect(source).not.toContain('—');
    expect(source).not.toMatch(/https?:\/\//);
  });
});
