import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { MadarApi } from '../api/calls';
import type { ChangeSignal, Kind } from '../api/remote/wire';
import { RuntimeProvider, createQueryClient, useCall } from './runtime';
import type { FreshReads } from '../api/remote/remoteApi';
import {
  affects, connectChanges, emptyMerge, followMeta, mergeSignals, readsAfterWrite, type ChangeListener, type ChangeOrigin, type ChangeSource,
} from './signals';

const ME = 'usr_001';
const OTHER = 'usr_002';

let next = 0;
/** One change signal. Each call makes a new id unless the test gives one. */
function sig(o: Partial<ChangeSignal> & { kinds: Kind[] }): ChangeSignal {
  next += 1;
  return { v: 1, id: `sig-${next}`, channel: 'office', seq: next, projects: [], office: false, people: [], storyId: 'cor_1', actorId: OTHER, ...o };
}

/** A query client with lists on screen, a fake channel, and the change rule between them. */
function setup(o: { me?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  let listener: ChangeListener | undefined;
  let open: 'open' | 'closed' = 'open';
  const source: ChangeSource = {
    subscribe(l) {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    status: () => open,
  };
  const loads = new Map<string, number>();
  const offs: (() => void)[] = [];
  /** A list on screen: an observer keeps the query active, so a reload runs its call again. */
  const show = (name: string, input: Record<string, unknown> = {}, data: unknown = {}, o: { enabled?: boolean } = {}) => {
    const key = JSON.stringify([name, input]);
    const observer = new QueryObserver(client, {
      queryKey: ['api', name, input],
      enabled: o.enabled ?? true,
      queryFn: async () => {
        loads.set(key, (loads.get(key) ?? 0) + 1);
        return data;
      },
    });
    offs.push(observer.subscribe(() => undefined));
    return () => loads.get(key) ?? 0;
  };
  const stop = connectChanges(client, source, () => o.me ?? ME);
  return {
    client,
    show,
    send: (signals: ChangeSignal[], origin?: ChangeOrigin, fresh?: FreshReads) => (fresh ? listener?.(signals, origin, fresh) : listener?.(signals, origin)),
    /** The load of a read in the follow step of a write: the runtime starts it with the tag of the step (FET-3). */
    follow: (name: string, input: Record<string, unknown>, tag: object) =>
      client.getQueryCache().find({ queryKey: ['api', name, input], exact: true })!.fetch(undefined, { cancelRefetch: true, meta: followMeta(tag) }),
    close: () => {
      open = 'closed';
    },
    stop: () => {
      stop();
      for (const off of offs) off();
    },
    /** Ends the change rule only; the lists stay on screen. */
    disconnect: stop,
    listening: () => listener !== undefined,
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('the change rule (plan 5.3, client map 3.3)', () => {
  it('reloads a project list only for a change in its project, or one that touches the office', () => {
    const merged = mergeSignals(emptyMerge(), sig({ kinds: ['tasks'], projects: ['prj_001'] }));
    expect(affects(['api', 'tasks.list', { projectId: 'prj_001' }], undefined, merged, ME)).toBe(true);
    expect(affects(['api', 'tasks.list', { projectId: 'prj_002' }], undefined, merged, ME)).toBe(false);
    // A list of every project knows no project, so it reloads.
    expect(affects(['api', 'tasks.list', {}], undefined, merged, ME)).toBe(true);
    // The project of a task comes from the cached answer.
    expect(affects(['api', 'tasks.get', { id: 'tsk_001' }], { task: { projectId: 'prj_002' } }, merged, ME)).toBe(false);
    expect(affects(['api', 'tasks.get', { id: 'tsk_001' }], { task: { projectId: 'prj_001' } }, merged, ME)).toBe(true);
    const office = mergeSignals(emptyMerge(), sig({ kinds: ['users'], office: true }));
    expect(affects(['api', 'tasks.list', { projectId: 'prj_002' }], undefined, office, ME)).toBe(true);
  });

  it('reloads only the lists that read a kind of the change', () => {
    const merged = mergeSignals(emptyMerge(), sig({ kinds: ['clients'], office: true }));
    expect(affects(['api', 'clients.list', {}], undefined, merged, ME)).toBe(true);
    expect(affects(['api', 'teams.list', {}], undefined, merged, ME)).toBe(false);
    // A touch of a project reloads the list sorted by the change time, not the lists that only show the project name.
    const touched = mergeSignals(emptyMerge(), sig({ kinds: ['projectTouched'], projects: ['prj_001'] }));
    expect(affects(['api', 'projects.list', {}], undefined, touched, ME)).toBe(true);
    expect(affects(['api', 'tasks.list', {}], undefined, touched, ME)).toBe(false);
  });

  it('reloads a personal list only for a signal that names this person', () => {
    const mine = mergeSignals(emptyMerge(), sig({ channel: `person:${ME}`, kinds: ['chatReads'], people: [ME] }));
    const theirs = mergeSignals(emptyMerge(), sig({ channel: `person:${OTHER}`, kinds: ['chatReads'], people: [OTHER] }));
    expect(affects(['api', 'chats.unreadCount', {}], undefined, mine, ME)).toBe(true);
    expect(affects(['api', 'chats.unreadCount', {}], undefined, theirs, ME)).toBe(false);
    expect(affects(['api', 'chats.list', {}], undefined, theirs, ME)).toBe(false);
  });

  it('reloads an unknown read to be safe, and never a signed link, a file or a screenshot', () => {
    const merged = mergeSignals(emptyMerge(), sig({ kinds: ['files'], projects: ['prj_001'] }));
    expect(affects(['api', 'something.new', {}], undefined, merged, ME)).toBe(true);
    for (const name of ['files.link', 'files.get', 'feedback.screenshot']) {
      expect(affects(['api', name, { id: 'fil_001' }], undefined, merged, ME)).toBe(false);
      expect(affects(['api', name, { id: 'fil_001' }], undefined, { ...emptyMerge(), all: true }, ME)).toBe(false);
    }
  });
});

describe('the reload after a change signal (plan 5.3)', () => {
  it('does not reload a list of project B for a signal of project A', async () => {
    const app = setup();
    const a = app.show('tasks.list', { projectId: 'prj_001' });
    const b = app.show('tasks.list', { projectId: 'prj_002' });
    await settle();
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([a(), b()]).toEqual([2, 1]);
    app.stop();
  });

  it('applies the signals of an own write at once', async () => {
    const app = setup();
    const list = app.show('tasks.list', { projectId: 'prj_001' });
    await settle();
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'], actorId: ME })], 'own');
    await settle();
    expect(list()).toBe(2);
    app.stop();
  });

  it('applies the own answers of one batch in one pass, so a list loads once for them', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', {});
    const clients = app.show('clients.list');
    await settle();
    // RemoteApi hands over the signals of each answer of a batch in one loop.
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'], actorId: ME })], 'own');
    app.send([sig({ kinds: ['tasks', 'clients'], projects: ['prj_002'], office: true, actorId: ME })], 'own');
    await Promise.resolve();
    await Promise.resolve();
    expect([tasks(), clients()]).toEqual([2, 2]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([tasks(), clients()]).toEqual([2, 2]);
    app.stop();
  });

  it('merges the changes of other people for 1 second, and for at most 2 seconds, into one pass', async () => {
    const app = setup();
    const list = app.show('tasks.list', {});
    await settle();
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await vi.advanceTimersByTimeAsync(600);
    app.send([sig({ kinds: ['tasks'], projects: ['prj_002'] })]);
    await vi.advanceTimersByTimeAsync(999);
    expect(list()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(list()).toBe(2);
    // A steady stream still reloads after 2 seconds.
    for (let n = 0; n < 5; n += 1) {
      app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(list()).toBe(3);
    app.stop();
  });

  it('reloads every list after a gap in the office seq', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_002' });
    const session = app.show('session.get');
    const clients = app.show('clients.list');
    await settle();
    app.send([sig({ kinds: ['clients'], office: true, seq: 10 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), clients()]).toEqual([1, 1, 2]);
    app.send([sig({ kinds: ['clients'], office: true, seq: 11 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), clients()]).toEqual([1, 1, 3]);
    // seq 12 never came.
    app.send([sig({ kinds: ['clients'], office: true, seq: 13 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), clients()]).toEqual([2, 2, 4]);
    app.stop();
  });

  it('reloads only the person lists after a gap in the person seq', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', {});
    const session = app.show('session.get');
    // The chat reads also read the preferences (the Admin's choice of what reaches the Admin), so the bell list is the person list here.
    const notices = app.show('notifications.list');
    await settle();
    app.send([sig({ channel: `person:${ME}`, kinds: ['preferences'], people: [ME], seq: 4 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), notices()]).toEqual([1, 2, 1]);
    app.send([sig({ channel: `person:${ME}`, kinds: ['preferences'], people: [ME], seq: 6 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), notices()]).toEqual([1, 3, 2]);
    app.stop();
  });

  it('makes no reload on the screen of person A for a read mark of person B', async () => {
    const app = setup({ me: ME });
    const chats = app.show('chats.list');
    const unread = app.show('chats.unreadCount');
    await settle();
    // Person B's own answer carries the signal of B's channel; A never gets it from Realtime, and must not reload for it.
    app.send([sig({ channel: `person:${OTHER}`, kinds: ['chatReads'], people: [OTHER], actorId: OTHER })]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([chats(), unread()]).toEqual([1, 1]);
    app.send([sig({ channel: `person:${ME}`, kinds: ['chatReads'], people: [ME], actorId: ME })], 'own');
    await settle();
    expect([chats(), unread()]).toEqual([2, 2]);
    app.stop();
  });

  it('applies the same change on two channels once', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    await settle();
    const office = sig({ kinds: ['tasks'], projects: ['prj_001'], seq: 1 });
    app.send([office]);
    await vi.advanceTimersByTimeAsync(1000);
    app.send([{ ...office, channel: `person:${ME}`, seq: 1, people: [ME] }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tasks()).toBe(2);
    app.stop();
  });

  it('keeps the person reload when the office signal of a change comes before its person signal', async () => {
    const app = setup();
    const chats = app.show('chats.list');
    const count = app.show('notifications.count');
    const tasks = app.show('tasks.list', {});
    await settle();
    // B writes in a project chat and A gets a notice: one save, two signals with one id.
    const office = sig({ kinds: ['messages', 'notifications'], projects: ['prj_001'], seq: 1 });
    app.send([office]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([chats(), count(), tasks()]).toEqual([2, 1, 1]);
    app.send([{ ...office, channel: `person:${ME}`, seq: 1, people: [ME] }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([chats(), count(), tasks()]).toEqual([2, 2, 1]);
    app.stop();
  });

  it('does not apply the signals of an own write again when Realtime sends them back', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    const count = app.show('notifications.count');
    await settle();
    const office = sig({ kinds: ['tasks', 'notifications'], projects: ['prj_001'], seq: 7, actorId: ME });
    const mine = { ...office, channel: `person:${ME}` as const, seq: 3, people: [ME] };
    app.send([office, mine], 'own');
    await settle();
    expect([tasks(), count()]).toEqual([2, 2]);
    app.send([office]);
    app.send([mine]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([tasks(), count()]).toEqual([2, 2]);
    app.stop();
  });

  it('keeps the own write of an office task right, though its signal names no actor and no story (review 2026-10-06)', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { filter: 'mine' });
    await settle();
    const office = sig({ kinds: ['events', 'tasks'], office: true, seq: 8 });
    delete office.actorId;
    delete office.storyId;
    app.send([office], 'own');
    await settle();
    expect(tasks()).toBe(2);
    // Realtime sends the same signal back: the id tells it apart, so the list loads no third time.
    app.send([office]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(tasks()).toBe(2);
    // The same change of another person still reloads the list.
    app.send([{ ...office, id: 'sig_other', seq: 9 }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(tasks()).toBe(3);
    app.stop();
  });

  it('reloads my lists for an office task change on my person channel, and no list of a project (review 2026-10-06)', async () => {
    const app = setup();
    const mine = app.show('tasks.list', { filter: 'mine' });
    const project = app.show('tasks.list', { projectId: 'prj_001' });
    const dashboard = app.show('dashboard.get');
    await settle();
    const change = sig({ kinds: ['events', 'tasks'], channel: `person:${ME}`, people: [ME], office: false, projects: [] });
    delete change.actorId;
    delete change.storyId;
    app.send([change]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([mine(), project(), dashboard()]).toEqual([2, 1, 2]);
    app.stop();
  });

  it('reloads at once when an own write comes back on Realtime before its answer', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    await settle();
    const office = sig({ kinds: ['tasks'], projects: ['prj_001'], seq: 2, actorId: ME });
    app.send([office]);
    await vi.advanceTimersByTimeAsync(100);
    app.send([office], 'own');
    await settle();
    expect(tasks()).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(tasks()).toBe(2);
    app.stop();
  });

  it('only marks the lists of a hidden tab, and reloads them when the tab shows again', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    const clients = app.show('clients.list');
    await settle();
    setHidden(true);
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), clients()]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(10_000);
    setHidden(false);
    await settle();
    expect([tasks(), clients()]).toEqual([2, 1]);
    app.stop();
  });

  it('reloads every list when a tab shows again after more than 60 seconds hidden', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    const clients = app.show('clients.list');
    await settle();
    setHidden(true);
    await vi.advanceTimersByTimeAsync(61_000);
    setHidden(false);
    await settle();
    expect([tasks(), clients()]).toEqual([2, 2]);
    app.stop();
  });

  it('reloads every list at once for an empty list: a change of the prototype store, or a channel that joins again', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    const session = app.show('session.get');
    const link = app.show('files.link', { id: 'fil_001', variant: 'full', disposition: 'inline' });
    await settle();
    app.send([]);
    // The invalidation runs in the listener itself, as the prototype did, with no merge window.
    expect(app.client.getQueryState(['api', 'tasks.list', { projectId: 'prj_001' }])?.isInvalidated).toBe(true);
    await settle();
    expect([tasks(), session(), link()]).toEqual([2, 2, 1]);
    app.stop();
  });

  it('starts the seq again after a channel joins again, so the first signal after it is not a gap', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_002' });
    await settle();
    app.send([sig({ kinds: ['clients'], office: true, seq: 5 })]);
    app.send([]);
    await settle();
    expect(tasks()).toBe(2);
    app.send([sig({ kinds: ['clients'], office: true, seq: 40 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tasks()).toBe(2);
    app.stop();
  });

  it('merges the join passes of both channels into one pass, 100 ms after the last join (performance audit FET-4)', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    const session = app.show('session.get');
    await settle();
    // One dropped socket: each channel joins again, a few milliseconds apart.
    app.send([], 'join');
    await vi.advanceTimersByTimeAsync(50);
    app.send([], 'join');
    await vi.advanceTimersByTimeAsync(99);
    expect([tasks(), session()]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect([tasks(), session()]).toEqual([2, 2]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([tasks(), session()]).toEqual([2, 2]);
    app.stop();
  });

  it('puts a signal that comes in the join window into the join pass, and does not move the pass later', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    const clients = app.show('clients.list');
    await settle();
    app.send([], 'join');
    await vi.advanceTimersByTimeAsync(30);
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await vi.advanceTimersByTimeAsync(70);
    expect([tasks(), clients()]).toEqual([2, 2]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([tasks(), clients()]).toEqual([2, 2]);
    app.stop();
  });

  it('starts the seq again at once at a join, so a signal in the join window is no gap of its own', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_002' });
    await settle();
    app.send([sig({ kinds: ['clients'], office: true, seq: 5 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tasks()).toBe(1);
    app.send([], 'join');
    app.send([sig({ kinds: ['clients'], office: true, seq: 40 })]);
    await vi.advanceTimersByTimeAsync(100);
    expect(tasks()).toBe(2);
    app.send([sig({ kinds: ['clients'], office: true, seq: 41 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tasks()).toBe(2);
    app.stop();
  });

  it('gives two joins far apart one pass each, so each channel that joins reloads after its own join', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    await settle();
    app.send([], 'join');
    await vi.advanceTimersByTimeAsync(100);
    expect(tasks()).toBe(2);
    await vi.advanceTimersByTimeAsync(900);
    app.send([], 'join');
    await vi.advanceTimersByTimeAsync(100);
    expect(tasks()).toBe(3);
    app.stop();
  });

  it('stops listening, and runs no pass after the stop', async () => {
    const app = setup();
    const tasks = app.show('tasks.list', { projectId: 'prj_001' });
    await settle();
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
    app.disconnect();
    expect(app.listening()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(61_000);
    setHidden(false);
    await settle();
    expect(tasks()).toBe(1);
    app.stop();
  });
});

describe('the own pass after a write with reads in its request (performance audit FET-3)', () => {
  const TASK = { id: 'tsk_001' };
  const LIST = { projectId: 'prj_001' };
  const own = () => sig({ kinds: ['tasks', 'events'], projects: ['prj_001'], actorId: ME });

  it('does not reload a read that ran after the write in its request, and reloads every other read that the signals name', async () => {
    const app = setup();
    const task = app.show('tasks.get', TASK, { task: { projectId: 'prj_001' } });
    const list = app.show('tasks.list', LIST);
    const feed = app.show('updates.list', LIST);
    await settle();
    const tag = {};
    await app.follow('tasks.get', TASK, tag);
    await app.follow('tasks.list', LIST, tag);
    expect([task(), list(), feed()]).toEqual([2, 2, 1]);
    app.send([own()], 'own', { tag, reads: [{ name: 'tasks.get', input: TASK }, { name: 'tasks.list', input: LIST }] });
    await settle();
    expect([task(), list(), feed()]).toEqual([2, 2, 2]);
    expect(app.client.getQueryState(['api', 'tasks.get', TASK])?.isInvalidated).toBe(false);
    app.stop();
  });

  it('reloads such a read when another load of it started after the load of the follow step', async () => {
    const app = setup();
    const list = app.show('tasks.list', LIST);
    await settle();
    const tag = {};
    await app.follow('tasks.list', LIST, tag);
    // A later load (for example a pass of Realtime) may have run before the write: it carries no tag.
    await app.client.refetchQueries({ queryKey: ['api', 'tasks.list', LIST] });
    expect(list()).toBe(3);
    app.send([own()], 'own', { tag, reads: [{ name: 'tasks.list', input: LIST }] });
    await settle();
    expect(list()).toBe(4);
    app.stop();
  });

  it('reloads every read that the signals name when the pass also holds a signal of Realtime', async () => {
    const app = setup();
    const list = app.show('tasks.list', LIST);
    await settle();
    const tag = {};
    await app.follow('tasks.list', LIST, tag);
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })]);
    app.send([own()], 'own', { tag, reads: [{ name: 'tasks.list', input: LIST }] });
    await settle();
    expect(list()).toBe(3);
    app.stop();
  });

  it('reloads a read when one own answer of the pass names it and another one does not', async () => {
    const app = setup();
    const list = app.show('tasks.list', LIST);
    await settle();
    const tag = {};
    await app.follow('tasks.list', LIST, tag);
    // Two writes in one request: the read ran after the first write, but before the second one.
    app.send([own()], 'own', { tag, reads: [{ name: 'tasks.list', input: LIST }] });
    app.send([own()], 'own');
    await settle();
    expect(list()).toBe(3);
    app.stop();
  });
});

describe('the echo of the own write that comes before the own answer (performance audit 2026-10-21, LV-2)', () => {
  const TASK = { id: 'tsk_001' };
  const LIST = { projectId: 'prj_001' };
  const kinds: Kind[] = ['tasks', 'events'];
  /** The office signal and the own person signal of one save: the same id, as the server sends them. */
  const save = () => {
    const office = sig({ kinds, projects: ['prj_001'], actorId: ME });
    const person: ChangeSignal = { ...office, channel: `person:${ME}`, people: [ME] };
    return { office, person };
  };
  /** A read that ran after the write in its request, with the tag of its follow step. */
  async function followed(app: ReturnType<typeof setup>) {
    const task = app.show('tasks.get', TASK, { task: { projectId: 'prj_001' } });
    const list = app.show('tasks.list', LIST);
    await settle();
    const tag = {};
    await app.follow('tasks.get', TASK, tag);
    await app.follow('tasks.list', LIST, tag);
    const fresh = { tag, reads: [{ name: 'tasks.get', input: TASK }, { name: 'tasks.list', input: LIST }] };
    return { task, list, fresh };
  }

  it('does not reload the reads of the follow step when the signals of Realtime come before the own answer', async () => {
    const app = setup();
    const { task, list, fresh } = await followed(app);
    const { office, person } = save();
    app.send([office], 'channel');
    app.send([person], 'channel');
    app.send([office, person], 'own', fresh);
    await settle();
    expect([task(), list()]).toEqual([2, 2]);
    await vi.advanceTimersByTimeAsync(2000);
    expect([task(), list()]).toEqual([2, 2]);
    app.stop();
  });

  it('does the same when only the office signal came first, and when the signals come after the own answer', async () => {
    const app = setup();
    const { task, list, fresh } = await followed(app);
    const first = save();
    app.send([first.office], 'channel');
    app.send([first.office, first.person], 'own', fresh);
    await settle();
    expect([task(), list()]).toEqual([2, 2]);
    // The echo after the answer names nothing new: it neither reloads nor blocks the next own pass.
    app.send([first.office], 'channel');
    app.send([first.person], 'channel');
    const second = save();
    const tag = {};
    await app.follow('tasks.list', LIST, tag);
    app.send([second.office, second.person], 'own', { tag, reads: [{ name: 'tasks.list', input: LIST }] });
    await settle();
    expect(list()).toBe(3);
    app.stop();
  });

  it('reloads every read the signals name when a signal of another change waits in the same pass', async () => {
    const app = setup();
    const { task, list, fresh } = await followed(app);
    const { office, person } = save();
    app.send([sig({ kinds: ['tasks'], projects: ['prj_001'] })], 'channel');
    app.send([office, person], 'channel');
    app.send([office, person], 'own', fresh);
    await settle();
    expect([task(), list()]).toEqual([3, 3]);
    app.stop();
  });

  it('reloads every read the signals name after a gap of the seq, or a channel that joined', async () => {
    const gap = setup();
    const a = await followed(gap);
    const one = save();
    // The office channel counted 1, and the echo of the own write comes with 5: signals were lost, so every list reloads.
    gap.send([{ ...sig({ kinds: ['clients'], office: true }), seq: 1 }], 'channel');
    gap.send([{ ...one.office, seq: 5 }], 'channel');
    gap.send([{ ...one.office, seq: 5 }], 'own', a.fresh);
    await settle();
    expect(a.list()).toBe(3);
    gap.stop();

    const joined = setup();
    const b = await followed(joined);
    const two = save();
    joined.send([two.office], 'channel');
    joined.send([], 'join');
    joined.send([two.office, two.person], 'own', b.fresh);
    await settle();
    expect([b.task(), b.list()]).toEqual([3, 3]);
    joined.stop();
  });

  it('reloads a read when the own answer names another save than the signal of Realtime', async () => {
    const app = setup();
    const { list, fresh } = await followed(app);
    app.send([save().office], 'channel');
    app.send([save().office, save().person], 'own', fresh);
    await settle();
    expect(list()).toBe(3);
    app.stop();
  });
});

describe('the reads that a write will change (performance audit FET-3)', () => {
  const ROW = (id: string) => ({ task: { id, projectId: 'prj_001' } });

  it('chooses the reads on screen that the kinds of the write touch: the record of the write first, then the others', async () => {
    const app = setup();
    app.show('session.get', {}, { user: { id: ME } });
    app.show('notifications.count', {}, 2);
    app.show('clients.list');
    app.show('tasks.list', { filter: 'mine' }, [ROW('tsk_009'), ROW('tsk_001')]);
    app.show('tasks.list', { filter: 'review_for_me' }, [ROW('tsk_005')]);
    app.show('tasks.get', { id: 'tsk_001' }, { task: { projectId: 'prj_001' } });
    await settle();
    const chosen = readsAfterWrite(app.client, 'tasks.complete', { id: 'tsk_001' }, ME).map((q) => q.queryKey.slice(1));
    // tasks.list of both filters is an overview read: only the one with the ticked row goes in the request of the write. The
    // session and the clients read no kind of the write.
    expect(chosen).toEqual([['tasks.get', { id: 'tsk_001' }], ['tasks.list', { filter: 'mine' }], ['notifications.count', {}]]);
    app.stop();
  });

  it('keeps to the project of the input, and takes every project when the input names none', async () => {
    const app = setup();
    app.show('tasks.list', { projectId: 'prj_001' });
    app.show('tasks.list', { projectId: 'prj_002' });
    await settle();
    const names = (input: unknown) => readsAfterWrite(app.client, 'tasks.create', input, ME).map((q) => q.queryKey[2]);
    expect(names({ projectId: 'prj_002', title: 'New' })).toEqual([{ projectId: 'prj_002' }]);
    expect(names({ title: 'Office errand' })).toEqual([{ projectId: 'prj_001' }, { projectId: 'prj_002' }]);
    app.stop();
  });

  it('takes at most 11 reads, so they fit with the write in one request of 12', async () => {
    const app = setup();
    for (let n = 0; n < 14; n += 1) app.show('tasks.get', { id: `tsk_${100 + n}` }, { task: { projectId: 'prj_001' } });
    await settle();
    expect(readsAfterWrite(app.client, 'tasks.update', { id: 'tsk_200', patch: {} }, ME)).toHaveLength(11);
    app.stop();
  });

  it('leaves out a read that never reloads, a read with no answer yet, a read that no screen shows, and a turned-off read', async () => {
    const app = setup();
    app.show('files.link', { id: 'fil_001', variant: 'thumb', disposition: 'inline' });
    app.show('tasks.list', { projectId: 'prj_001' }, [], { enabled: false });
    app.show('tasks.get', { id: 'tsk_002' }, { task: { projectId: 'prj_001' } });
    await settle();
    // A read whose screen closed, and a read on screen whose first answer still loads.
    app.client.setQueryData(['api', 'tasks.get', { id: 'tsk_003' }], { task: { projectId: 'prj_001' } });
    const loading = new QueryObserver(app.client, { queryKey: ['api', 'tasks.get', { id: 'tsk_004' }], queryFn: () => new Promise(() => undefined) });
    const off = loading.subscribe(() => undefined);
    expect(readsAfterWrite(app.client, 'files.markDelivered', { id: 'fil_001' }, ME).map((q) => q.queryKey[2])).toEqual([{ id: 'tsk_002' }]);
    off();
    app.stop();
  });

  it('chooses nothing for a write with no line, and the personal lists of the actor only for a personal kind', async () => {
    const app = setup();
    app.show('chats.unreadCount');
    app.show('clients.list');
    await settle();
    expect(readsAfterWrite(app.client, 'agents.remove', { agentId: 'usr_009' }, ME)).toEqual([]);
    expect(readsAfterWrite(app.client, 'chats.markRead', { conversationId: 'cnv_001' }, ME).map((q) => q.queryKey[1])).toEqual(['chats.unreadCount']);
    expect(readsAfterWrite(app.client, 'chats.markRead', { conversationId: 'cnv_001' }, '')).toEqual([]);
    app.stop();
  });
});

describe('the runtime and its change source (plan R2)', () => {
  it('keeps the answers of the real build until a signal names them, except the reads that never reload', () => {
    const remote = createQueryClient({ remote: true });
    expect(remote.getQueryDefaults(['api', 'tasks.list', {}]).staleTime).toBe(Infinity);
    expect(remote.getQueryDefaults(['api', 'session.get', {}]).staleTime).toBe(Infinity);
    for (const name of ['files.link', 'feedback.screenshot']) expect(remote.getQueryDefaults(['api', name, {}]).staleTime).toBe(0);
    expect(remote.getQueryDefaults(['file-blob', 'fil_001']).staleTime).toBeUndefined();
    const prototype = createQueryClient();
    expect(prototype.getDefaultOptions().queries?.staleTime).toBe(0);
    expect(prototype.getQueryDefaults(['api', 'tasks.list', {}]).staleTime).toBeUndefined();
  });

  it('reloads a personal list of the person whose session is on screen', async () => {
    let listener: ChangeListener | undefined;
    const source: ChangeSource = {
      subscribe: (l) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
      status: () => 'open',
    };
    const loads: string[] = [];
    const api = {
      call: async (name: string) => {
        loads.push(name);
        return name === 'session.get' ? { user: { id: ME } } : 0;
      },
      run: async () => ({ output: null, storyId: '', changed: false }),
    } as unknown as MadarApi;
    function Badge() {
      useCall('session.get', {});
      return <span>{String(useCall('chats.unreadCount', {}).data ?? '')}</span>;
    }
    const queryClient = createQueryClient({ remote: true });
    const view = render(<RuntimeProvider runtime={{ api, changes: source, mode: 'remote' }} queryClient={queryClient}><Badge /></RuntimeProvider>);
    await settle();
    expect(loads.sort()).toEqual(['chats.unreadCount', 'session.get']);
    listener?.([sig({ channel: `person:${OTHER}`, kinds: ['chatReads'], people: [OTHER] })], 'own');
    await settle();
    expect(loads.filter((name) => name === 'chats.unreadCount')).toHaveLength(1);
    listener?.([sig({ channel: `person:${ME}`, kinds: ['chatReads'], people: [ME] })], 'own');
    await settle();
    expect(loads.filter((name) => name === 'chats.unreadCount')).toHaveLength(2);
    view.unmount();
    expect(listener).toBeUndefined();
  });
});
