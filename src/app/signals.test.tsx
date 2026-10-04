import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { MadarApi } from '../api/calls';
import type { ChangeSignal, Kind } from '../api/remote/wire';
import { RuntimeProvider, createQueryClient, useCall } from './runtime';
import { affects, connectChanges, emptyMerge, mergeSignals, type ChangeListener, type ChangeSource } from './signals';

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
  const show = (name: string, input: Record<string, unknown> = {}, data: unknown = {}) => {
    const key = JSON.stringify([name, input]);
    const observer = new QueryObserver(client, {
      queryKey: ['api', name, input],
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
    send: (signals: ChangeSignal[], origin?: 'own' | 'channel') => listener?.(signals, origin),
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
    const chats = app.show('chats.list');
    await settle();
    app.send([sig({ channel: `person:${ME}`, kinds: ['preferences'], people: [ME], seq: 4 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), chats()]).toEqual([1, 2, 1]);
    app.send([sig({ channel: `person:${ME}`, kinds: ['preferences'], people: [ME], seq: 6 })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([tasks(), session(), chats()]).toEqual([1, 3, 2]);
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

describe('the runtime and its change source (plan R2)', () => {
  it('keeps the answers of the real build until a signal names them, except the reads that never reload', () => {
    const remote = createQueryClient({ remote: true });
    expect(remote.getQueryDefaults(['api', 'tasks.list', {}]).staleTime).toBe(Infinity);
    expect(remote.getQueryDefaults(['api', 'session.get', {}]).staleTime).toBe(Infinity);
    for (const name of ['files.link', 'usage.get', 'feedback.screenshot']) expect(remote.getQueryDefaults(['api', name, {}]).staleTime).toBe(0);
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
