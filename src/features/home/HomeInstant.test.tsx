import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { alwaysSignedIn, type AuthPort, type AuthStatus } from '../../app/auth';
import { clearHomeCache, readHomeRecord, saveHomeRecord, HOME_DB, MAX_AGE_MS } from '../../app/remote/homeCache';
import type { State } from '../../api/store';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';

/**
 * Instant Home after a relaunch (performance audit 2026-10-21, DF-14, owner: "keep the last Home lists of each person in the
 * browser, show them at once, replace them with fresh data in about 1 s. Clear at sign-out and on a role change").
 * One page life writes the record. The next page life starts with a held network and must show the rows before any answer.
 */
const AUTH_A = 'auth-user-a';
const AUTH_B = 'auth-user-b';
const MEMBER = 'usr_003';
const ADMIN = 'usr_001';
const LIST = { name: 'Your projects' } as const;

type Listener = (status: AuthStatus) => void;
/** A sign-in port with a user id that a test can change, as the Supabase port does when a person leaves or another signs in. */
function homeAuth(initial: string | null) {
  let id = initial;
  const listeners = new Set<Listener>();
  const port: AuthPort & { become(next: string | null): void } = {
    ...alwaysSignedIn(),
    status: () => (id ? 'signed_in' : 'signed_out'),
    userId: () => id,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    become(next) {
      id = next;
      for (const listener of [...listeners]) listener(id ? 'signed_in' : 'signed_out');
    },
  };
  return port;
}

const as = (userId: string, more?: (state: State) => void) => (state: State) => {
  state.session.currentUserId = userId;
  more?.(state);
};
const flush = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const RENAMED = 'Tamr Staff Housing, new name';
const STORED_NAME = 'Tamr Staff Housing';

/** The first page life: a normal load. It ends when the record is on disk. */
async function firstLife(authId: string, prepare: (state: State) => void = as(MEMBER)) {
  const app = await renderHeldRemoteApp('/', prepare, { auth: homeAuth(authId), home: { gapMs: 0 } });
  await screen.findByRole('list', LIST, { timeout: 10_000 });
  await waitFor(async () => expect(await readHomeRecord(authId, 5000)).not.toBeNull(), { timeout: 10_000 });
  app.stopHome();
  app.unmount();
  cleanup();
  return app;
}

/** The database answers an open request "ms" late, as a slow phone does. */
function slowOpen(ms: number) {
  const real = indexedDB.open.bind(indexedDB);
  vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
    const actual = real(name, version);
    const fake = {} as { onsuccess?: (event: Event) => void; onupgradeneeded?: (event: Event) => void; onerror?: (event: Event) => void; onblocked?: (event: Event) => void };
    Object.defineProperty(fake, 'result', { get: () => actual.result });
    Object.defineProperty(fake, 'error', { get: () => actual.error });
    actual.onupgradeneeded = (event) => fake.onupgradeneeded?.(event);
    actual.onerror = (event) => fake.onerror?.(event);
    actual.onsuccess = (event) => { setTimeout(() => fake.onsuccess?.(event), ms); };
    return fake as unknown as IDBOpenDBRequest;
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await clearHomeCache();
});

describe('Home after a relaunch, real build (DF-14)', () => {
  it('writes the record once the fresh answers settle, with the reads of the first request and no token', async () => {
    await firstLife(AUTH_A);
    const record = await readHomeRecord(AUTH_A, 5000);
    expect(record?.build).toBe('test');
    const names = record!.entries.map((entry) => entry.key[1]).sort();
    expect(names).toEqual(['chats.unreadCount', 'meetings.list', 'notifications.count', 'projects.list', 'session.get', 'subCompanies.list', 'tasks.list', 'tasks.list', 'users.list']);
    expect(JSON.stringify(record)).not.toMatch(/token/i);
  });

  it('shows the stored rows before any answer, then the fresh answers replace them', async () => {
    await firstLife(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER, (state) => {
      for (const project of Object.values(state.projects)) if (project.name === STORED_NAME) project.name = RENAMED;
    }), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    const list = await screen.findByRole('list', LIST, { timeout: 10_000 });
    // No answer came yet: the rows are the stored ones.
    expect(app.asked.map((call) => call.name)).toContain('session.get');
    expect(list).toHaveTextContent(STORED_NAME);
    expect(list).not.toHaveTextContent(RENAMED);
    app.release();
    await waitFor(() => expect(screen.getByRole('list', LIST)).toHaveTextContent(RENAMED), { timeout: 10_000 });
  });

  it('sends each read once: the stored answers add no second request for a read that is already on the wire', async () => {
    await firstLife(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    await screen.findByRole('list', LIST, { timeout: 10_000 });
    app.release();
    await flush(300);
    for (const name of ['session.get', 'tasks.list', 'chats.unreadCount', 'notifications.count', 'subCompanies.list', 'users.list']) {
      const count = app.asked.filter((call) => call.name === name).length;
      expect(count, name).toBe(name === 'tasks.list' ? 2 : 1);
    }
  });

  it('removes a project the person may no longer see when the fresh answer comes', async () => {
    await firstLife(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER, (state) => {
      const gone = Object.values(state.projects).find((project) => project.name === STORED_NAME)!;
      for (const key of Object.keys(state.members)) if (state.members[key].projectId === gone.id && state.members[key].userId === MEMBER) delete state.members[key];
      if (gone.leaderId === MEMBER) gone.leaderId = ADMIN;
    }), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    expect(await screen.findByRole('list', LIST, { timeout: 10_000 })).toHaveTextContent(STORED_NAME);
    app.release();
    await waitFor(() => expect(screen.getByRole('list', LIST)).not.toHaveTextContent(STORED_NAME), { timeout: 10_000 });
  });

  it('ignores the record of another auth user id and deletes it', async () => {
    await firstLife(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: homeAuth(AUTH_B), home: { gapMs: 0 } });
    await flush(300);
    expect(screen.queryByRole('list', LIST)).toBeNull();
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    app.release();
    await screen.findByRole('list', LIST, { timeout: 10_000 });
  });

  it('ignores a record of another build, and a record older than 7 days, and deletes them', async () => {
    await firstLife(AUTH_A);
    const stored = (await readHomeRecord(AUTH_A, 5000))!;
    await saveHomeRecord(AUTH_A, { ...stored, build: 'older-build' });
    const app = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    await flush(300);
    expect(screen.queryByRole('list', LIST)).toBeNull();
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    app.stopHome();
    app.unmount();
    cleanup();
    await saveHomeRecord(AUTH_A, { ...stored, build: 'test', at: Date.now() - MAX_AGE_MS - 60_000 });
    const old = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    await flush(300);
    expect(screen.queryByRole('list', LIST)).toBeNull();
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    old.release();
  });

  it('clears the record and the shown lists when the fresh session shows another role', async () => {
    await firstLife(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER, (state) => {
      state.users[MEMBER].systemRole = 'management';
    }), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    expect(await screen.findByRole('list', LIST, { timeout: 10_000 })).toHaveTextContent(STORED_NAME);
    // Only the session answers. Its role is not the stored one.
    app.releaseHeld((name) => name === 'session.get');
    await waitFor(() => expect(screen.queryByRole('list', LIST)).toBeNull(), { timeout: 10_000 });
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    app.release();
    await screen.findByRole('list', LIST, { timeout: 10_000 });
  });

  it('keeps the shown lists when the fresh session shows the same role and rights', async () => {
    await firstLife(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    expect(await screen.findByRole('list', LIST, { timeout: 10_000 })).toHaveTextContent(STORED_NAME);
    app.releaseHeld((name) => name === 'session.get');
    await flush(200);
    expect(screen.getByRole('list', LIST)).toHaveTextContent(STORED_NAME);
    app.release();
  });

  it('clears the record at a sign-out and when another person signs in', async () => {
    await firstLife(AUTH_A);
    const out = homeAuth(AUTH_A);
    const app = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: out, home: { gapMs: 0 } });
    await screen.findByRole('list', LIST, { timeout: 10_000 });
    expect(await readHomeRecord(AUTH_A, 5000)).not.toBeNull();
    out.become(null);
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    app.release();
    app.stopHome();
    app.unmount();
    cleanup();

    await firstLife(AUTH_A);
    const other = homeAuth(AUTH_A);
    const second = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: other, home: { gapMs: 0 } });
    await screen.findByRole('list', LIST, { timeout: 10_000 });
    other.become(AUTH_B);
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    second.release();
  });

  it('skips a read that takes more than the limit, and loads as before', async () => {
    await firstLife(AUTH_A);
    // The database answers 400 ms late: the limit (50 ms here, 150 ms in the build) has passed.
    slowOpen(400);
    const app = await renderHeldRemoteApp('/', as(MEMBER), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0, readLimitMs: 50 } });
    await flush(700);
    expect(screen.queryByRole('list', LIST)).toBeNull();
    app.release();
    await screen.findByRole('list', LIST, { timeout: 10_000 });
    expect(screen.getByRole('list', LIST)).toHaveTextContent(STORED_NAME);
  });

  it('shows no stored list when the fresh session came first with another role (a late read)', async () => {
    await firstLife(AUTH_A);
    slowOpen(400);
    const app = await renderHeldRemoteApp('/', as(MEMBER, (state) => {
      state.users[MEMBER].systemRole = 'management';
    }), { hold: true, auth: homeAuth(AUTH_A), home: { gapMs: 0, readLimitMs: 5000 } });
    app.releaseHeld((name) => name === 'session.get');
    await flush(900);
    expect(screen.queryByRole('list', LIST)).toBeNull();
    await waitFor(async () => expect(await readHomeRecord(AUTH_A, 5000)).toBeNull());
    app.release();
    await screen.findByRole('list', LIST, { timeout: 10_000 });
  });

  it.each([
    ['open throws', () => vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('SecurityError'); })],
    ['open fails', () => {
      vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        const request = {} as { onerror?: (event: Event) => void; error: Error };
        request.error = new Error('UnknownError');
        setTimeout(() => request.onerror?.(new Event('error')), 0);
        return request as unknown as IDBOpenDBRequest;
      });
    }],
    ['indexedDB is missing', () => { vi.stubGlobal('indexedDB', undefined); }],
  ])('loads as before with no error on screen when IndexedDB is not usable (%s)', async (_name, break_) => {
    break_();
    const app = await renderHeldRemoteApp('/', as(MEMBER), { auth: homeAuth(AUTH_A), home: { gapMs: 0 } });
    await screen.findByRole('list', LIST, { timeout: 10_000 });
    // The write at idle runs too. Nothing reaches the screen.
    await flush(500);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('list', LIST)).toBeInTheDocument();
    app.stopHome();
  });

  it('starts nothing in the prototype and for a port with no user id', async () => {
    const proto = await import('../../app/remote/homeCache');
    const { QueryClient } = await import('@tanstack/react-query');
    const client = new QueryClient();
    client.setQueryData(['api', 'session.get', {}], { user: { systemRole: 'member' }, authority: {} });
    const api = { call: async () => ({}) } as never;
    const stops = [
      proto.startHomeCache({ queryClient: client, runtime: { api, mode: 'prototype', auth: homeAuth(AUTH_A) }, build: 'test', gapMs: 0 }),
      proto.startHomeCache({ queryClient: client, runtime: { api, mode: 'remote', auth: alwaysSignedIn() }, build: 'test', gapMs: 0 }),
      proto.startHomeCache({ queryClient: client, runtime: { api, mode: 'remote' }, build: 'test', gapMs: 0 }),
    ];
    await flush(400);
    const databases = await indexedDB.databases();
    expect(databases.map((db) => db.name)).not.toContain(HOME_DB);
    for (const stop of stops) stop();
  });
});
