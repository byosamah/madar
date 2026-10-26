import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { State } from '../api/store';
import { renderHeldRemoteApp, type Asked } from '../test/heldRemoteApp';
import { phoneMedia } from '../test/phoneMedia';

/**
 * A press on a main tab starts the main read of its screen (performance audit 2026-10-21, LV-9). A first open of a screen waited one
 * full Edge trip after the click. The read starts on pointerdown, about 50 to 150 ms before the click ends, and the screen finds the
 * answer in the cache. Hover starts nothing: a hover on a tab that nobody opens would cost quota.
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const timesAsked = (asked: Asked[], name: string, input: unknown) => asked.filter((call) => call.name === name && same(call.input, input)).length;
const observed = (client: QueryClient, name: string, input: unknown) =>
  client.getQueryCache().find({ queryKey: ['api', name, input], exact: true })?.getObserversCount() ?? 0;

/** Opens the app at a screen, lets the first answers come, and holds the later ones. */
async function openAt(path: string) {
  const app = await renderHeldRemoteApp(path, as('usr_001'));
  await waitFor(() => expect(app.queryClient.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 10_000 });
  await flush(150);
  app.hold();
  return app;
}

const CASES: [string, string, string, { name: string; input: unknown }][] = [
  ['Projects', 'Projects', '/projects', { name: 'projects.list', input: { status: 'active', sort: 'updated', filter: 'all' } }],
  ['Dashboard', 'Dashboard', '/dashboard', { name: 'dashboard.get', input: { status: 'active' } }],
  ['Inbox', 'Inbox', '/inbox', { name: 'chats.list', input: {} }],
  ['the bell', 'Notifications', '/notifications', { name: 'notifications.list', input: {} }],
];

describe('a press on a main tab starts the read of its screen (LV-9)', () => {
  it.each(CASES)('%s: pointerdown starts the read, and the screen asks the server for it once', async (_label, name, path, read) => {
    const app = await openAt('/work');
    expect(timesAsked(app.asked, read.name, read.input)).toBe(0);
    const link = (await screen.findAllByRole('link', { name: new RegExp(`^${name}`) }))[0];
    fireEvent.pointerDown(link);
    await flush();
    expect(timesAsked(app.asked, read.name, read.input)).toBe(1);
    await act(async () => { await app.router.navigate(path); });
    app.release();
    await waitFor(() => expect(observed(app.queryClient, read.name, read.input)).toBeGreaterThan(0), { timeout: 10_000 });
    await flush(100);
    expect(timesAsked(app.asked, read.name, read.input)).toBe(1);
  }, 60_000);

  it('starts nothing on hover or focus', async () => {
    const app = await openAt('/work');
    const before = app.asked.length;
    for (const name of ['Projects', 'Dashboard', 'Notifications']) {
      const link = (await screen.findAllByRole('link', { name: new RegExp(`^${name}`) }))[0];
      fireEvent.pointerEnter(link);
      fireEvent.mouseOver(link);
      fireEvent.focus(link);
    }
    await flush(50);
    expect(app.asked.length).toBe(before);
  }, 60_000);

  it('uses the stored sort of Projects in the read', async () => {
    window.localStorage.setItem('madar.projects.sort', 'deadline');
    const app = await openAt('/work');
    const link = (await screen.findAllByRole('link', { name: /^Projects/ }))[0];
    fireEvent.pointerDown(link);
    await flush();
    expect(timesAsked(app.asked, 'projects.list', { status: 'active', sort: 'deadline', filter: 'all' })).toBe(1);
  }, 60_000);
});

describe('a press on the Projects tab for an Admin with "Only my work" (owner, 2026-10-26, fbk_065)', () => {
  it('starts the read of "mine", and the screen asks the server for it once', async () => {
    const app = await renderHeldRemoteApp('/work', (state) => {
      state.session.currentUserId = 'usr_001';
      state.users.usr_001.preferences.adminReach = 'mine';
    });
    await waitFor(() => expect(app.queryClient.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 10_000 });
    await flush(150);
    app.hold();
    const input = { status: 'active', sort: 'updated', filter: 'mine' };
    const link = (await screen.findAllByRole('link', { name: /^Projects/ }))[0];
    fireEvent.pointerDown(link);
    await flush();
    expect(timesAsked(app.asked, 'projects.list', input)).toBe(1);
    await act(async () => { await app.router.navigate('/projects'); });
    app.release();
    await waitFor(() => expect(observed(app.queryClient, 'projects.list', input)).toBeGreaterThan(0), { timeout: 10_000 });
    await flush(100);
    expect(timesAsked(app.asked, 'projects.list', input)).toBe(1);
    expect(timesAsked(app.asked, 'projects.list', { status: 'active', sort: 'updated', filter: 'all' })).toBe(0);
  }, 60_000);
});

describe('a press on a phone tab starts the reads of its target', () => {
  const PHONE_CASES: [string, string, string, { name: string; input: unknown }[]][] = [
    ['Work', '^Work', '/work', [
      { name: 'tasks.list', input: { filter: 'mine', includeDone: false } },
      { name: 'tasks.list', input: { filter: 'review_for_me' } },
    ]],
    ['Inbox', '^Inbox', '/inbox', [{ name: 'chats.list', input: {} }]],
  ];

  it.each(PHONE_CASES)('%s: pointerdown starts the reads once, and the screen asks for nothing again', async (_label, pattern, path, reads) => {
    phoneMedia(true);
    const app = await openAt('/whats-new');
    for (const read of reads) expect(timesAsked(app.asked, read.name, read.input)).toBe(0);
    const link = (await screen.findAllByRole('link', { name: new RegExp(pattern) }))[0];
    fireEvent.pointerDown(link);
    await flush();
    for (const read of reads) expect(timesAsked(app.asked, read.name, read.input)).toBe(1);
    await act(async () => { await app.router.navigate(path); });
    app.release();
    await waitFor(() => expect(observed(app.queryClient, reads[0].name, reads[0].input)).toBeGreaterThan(0), { timeout: 10_000 });
    await flush(100);
    for (const read of reads) expect(timesAsked(app.asked, read.name, read.input)).toBe(1);
  }, 60_000);

  it('Me: pointerdown starts settings.get once', async () => {
    phoneMedia(true);
    const app = await openAt('/whats-new');
    const before = timesAsked(app.asked, 'settings.get', {});
    const link = (await screen.findAllByRole('link', { name: /^Me/ }))[0];
    fireEvent.pointerDown(link);
    await flush();
    expect(timesAsked(app.asked, 'settings.get', {})).toBeLessThanOrEqual(Math.max(before, 1));
    await act(async () => { await app.router.navigate('/me'); });
    app.release();
    await flush(100);
    expect(timesAsked(app.asked, 'settings.get', {})).toBeLessThanOrEqual(Math.max(before, 1));
  }, 60_000);
});
