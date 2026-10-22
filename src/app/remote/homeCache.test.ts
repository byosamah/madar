import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { alwaysSignedIn, type AuthPort, type AuthStatus } from '../auth';
import { phoneMedia } from '../../test/phoneMedia';
import { clearHomeCache, fingerprintOf, homeKeys, MAX_BYTES, readHomeRecord, saveHomeRecord, startHomeCache } from './homeCache';

const TODAY = '2026-09-30';
const AUTH = 'auth-user-a';
const api = { call: async () => ({}) } as never;

function port(initial: string | null) {
  let id = initial;
  const listeners = new Set<(status: AuthStatus) => void>();
  const auth: AuthPort & { become(next: string | null): void } = {
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
  return auth;
}

const session = (role = 'member', rights: string[] = ['a', 'b']) => ({ user: { id: 'usr_1', systemRole: role, roleId: null }, authority: { officeRights: rights } });

/** Puts fresh answers for the Home reads of a member into the client. Call it after the start: a fresh answer is newer than the start. */
function fill(client: QueryClient, o: { role?: string; big?: number } = {}) {
  const set = (key: unknown[], data: unknown) => client.setQueryData(key, data);
  set(['api', 'session.get', {}], session(o.role));
  set(['api', 'tasks.list', { filter: 'mine' }], []);
  set(['api', 'tasks.list', { filter: 'review_for_me' }], []);
  set(['api', 'chats.unreadCount', {}], { unread: 2 });
  set(['api', 'users.list', {}], o.big ? [{ id: 'usr_1', blob: 'x'.repeat(o.big) }] : []);
}

const options = (client: QueryClient, auth: AuthPort, more: object = {}) => ({
  queryClient: client, runtime: { api, auth, mode: 'remote' as const }, build: 'b1', today: () => TODAY, gapMs: 0, ...more,
});
const stored = async () => readHomeRecord(AUTH, 5000);
const puts = () => vi.spyOn(IDBObjectStore.prototype, 'put');

afterEach(async () => {
  vi.restoreAllMocks();
  await clearHomeCache();
});

describe('what a record holds', () => {
  it('lists the reads of a cold Home for a member and for an Admin', () => {
    const member = homeKeys('member', TODAY).map((key) => `${key[1]} ${JSON.stringify(key[2])}`);
    expect(member).toEqual([
      'session.get {}', 'chats.unreadCount {}', 'notifications.count {}', 'tasks.list {"filter":"mine"}', 'tasks.list {"filter":"review_for_me"}',
      'meetings.list {"from":"2026-09-30","to":"2026-09-30","mine":true}', 'projects.list {"filter":"mine","status":"all","sort":"deadline"}',
      'subCompanies.list {}', 'users.list {}',
    ]);
    expect(homeKeys('admin', TODAY).map((key) => JSON.stringify(key[2]))).toContain('{"filter":"all","sort":"deadline"}');
  });

  it('leaves projects.list out of the keys of a phone, and keeps it in the default', () => {
    const names = (phone?: boolean) => homeKeys('member', TODAY, phone).map((key) => key[1]);
    expect(names(true)).toEqual(['session.get', 'chats.unreadCount', 'notifications.count', 'tasks.list', 'tasks.list', 'meetings.list', 'subCompanies.list', 'users.list']);
    expect(names()).toContain('projects.list');
    expect(homeKeys('admin', TODAY, true).map((key) => key[1])).not.toContain('projects.list');
  });

  it('writes no projects.list on a phone, and shows no stored projects.list on a phone', async () => {
    phoneMedia(true);
    // A: a fresh projects.list answer on a phone is not written.
    const client = new QueryClient();
    const stop = startHomeCache(options(client, port(AUTH)));
    fill(client);
    client.setQueryData(['api', 'projects.list', { filter: 'mine', status: 'all', sort: 'deadline' }], []);
    await vi.waitFor(async () => expect(await stored()).not.toBeNull(), { timeout: 3000 });
    const record = (await stored())!;
    expect(record.entries.map((entry) => entry.key[1])).not.toContain('projects.list');
    expect(record.entries.map((entry) => entry.key[1])).toContain('chats.unreadCount');
    expect(record.entries.filter((entry) => entry.key[1] === 'tasks.list')).toHaveLength(2);
    stop();
    await clearHomeCache();
    // B: a record of a desk browser holds projects.list. A phone shows the other entries and not that one.
    const at = Date.now();
    const entry = (key: unknown[], data: unknown) => ({ key, data, at });
    await saveHomeRecord(AUTH, {
      build: 'b1', at, fingerprint: fingerprintOf(session()),
      entries: [
        entry(['api', 'session.get', {}], session()),
        entry(['api', 'tasks.list', { filter: 'mine' }], []),
        entry(['api', 'tasks.list', { filter: 'review_for_me' }], []),
        entry(['api', 'projects.list', { filter: 'mine', status: 'all', sort: 'deadline' }], [{ project: { id: 'prj_x' } }]),
      ],
    });
    const second = new QueryClient();
    const stopSecond = startHomeCache(options(second, port(AUTH), { readLimitMs: 5000 }));
    await vi.waitFor(() => expect(second.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 3000 });
    expect(second.getQueryData(['api', 'projects.list', { filter: 'mine', status: 'all', sort: 'deadline' }])).toBeUndefined();
    stopSecond();
  });

  it('changes the fingerprint for another role, another role id or other rights, and not for the same ones in another order', () => {
    const base = fingerprintOf(session('member', ['a', 'b']));
    expect(fingerprintOf(session('member', ['b', 'a']))).toBe(base);
    expect(fingerprintOf(session('management', ['a', 'b']))).not.toBe(base);
    expect(fingerprintOf(session('member', ['a']))).not.toBe(base);
    expect(fingerprintOf({ ...session(), user: { ...session().user, roleId: 'rol_9' } })).not.toBe(base);
  });
});

describe('the write', () => {
  it('writes once after the fresh answers settle, and not while a Home read still runs', async () => {
    const client = new QueryClient();
    const auth = port(AUTH);
    const put = puts();
    const stop = startHomeCache(options(client, auth));
    fill(client);
    // A read that has not answered yet: the record waits.
    void client.fetchQuery({ queryKey: ['api', 'notifications.count', {}], queryFn: () => new Promise((resolve) => setTimeout(() => resolve({ badge: 1 }), 600)) });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(put).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await stored()).not.toBeNull(), { timeout: 3000 });
    expect(put).toHaveBeenCalledTimes(1);
    const record = (await stored())!;
    expect(record.entries.map((entry) => entry.key[1])).toContain('notifications.count');
    expect(record.build).toBe('b1');
    stop();
  });

  it('writes again at most once in the gap after later changes', async () => {
    const client = new QueryClient();
    const put = puts();
    const stop = startHomeCache(options(client, port(AUTH), { gapMs: 800 }));
    fill(client);
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1), { timeout: 3000 });
    for (let n = 0; n < 5; n += 1) client.setQueryData(['api', 'chats.unreadCount', {}], { unread: 3 + n });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(put).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect((await stored())!.entries.find((entry) => entry.key[1] === 'chats.unreadCount')!.data).toEqual({ unread: 7 });
    stop();
  });

  it('writes nothing for a record over 1 MB', async () => {
    const client = new QueryClient();
    const put = puts();
    const stop = startHomeCache(options(client, port(AUTH)));
    fill(client, { big: MAX_BYTES + 10 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(put).not.toHaveBeenCalled();
    expect(await stored()).toBeNull();
    stop();
  });

  it('writes nothing without the session and both task lists', async () => {
    const client = new QueryClient();
    client.setQueryData(['api', 'chats.unreadCount', {}], { unread: 1 });
    const put = puts();
    const stop = startHomeCache(options(client, port(AUTH)));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(put).not.toHaveBeenCalled();
    stop();
  });

  it('never writes after a sign-out, even when the write was already waiting', async () => {
    const client = new QueryClient();
    const auth = port(AUTH);
    const put = puts();
    const stop = startHomeCache(options(client, auth));
    fill(client);
    // The write waits for an idle moment (200 ms here). The person signs out before it runs.
    auth.become(null);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(put).not.toHaveBeenCalled();
    expect(await stored()).toBeNull();
    stop();
  });

  it('does not keep a stored answer as a fresh one: an answer of an earlier life is not written again', async () => {
    const client = new QueryClient();
    const before = Date.now() - 60_000;
    client.setQueryData(['api', 'session.get', {}], session(), { updatedAt: before });
    client.setQueryData(['api', 'tasks.list', { filter: 'mine' }], [], { updatedAt: before });
    client.setQueryData(['api', 'tasks.list', { filter: 'review_for_me' }], [], { updatedAt: before });
    const put = puts();
    const stop = startHomeCache(options(client, port(AUTH)));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(put).not.toHaveBeenCalled();
    stop();
  });
});

describe('the clear', () => {
  it('clears at the end of the session and for another person, and starts the new person', async () => {
    const client = new QueryClient();
    const auth = port(AUTH);
    const stop = startHomeCache(options(client, auth));
    fill(client);
    await vi.waitFor(async () => expect(await stored()).not.toBeNull(), { timeout: 3000 });
    auth.become('auth-user-b');
    await vi.waitFor(async () => expect(await stored()).toBeNull(), { timeout: 3000 });
    stop();
  });

  it('clears the leftovers at a start with no session', async () => {
    const client = new QueryClient();
    const stopA = startHomeCache(options(client, port(AUTH)));
    fill(client);
    await vi.waitFor(async () => expect(await stored()).not.toBeNull(), { timeout: 3000 });
    stopA();
    const stopB = startHomeCache(options(new QueryClient(), port(null)));
    await vi.waitFor(async () => expect(await stored()).toBeNull(), { timeout: 3000 });
    stopB();
  });
});
