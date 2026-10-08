import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import type { TaskDetail, TaskRow } from '../api/contract/views';
import { calls, type Calls, type MadarApi } from '../api/calls';
import { createApi } from '../api/client';
import { ApiError } from '../api/errors';
import { memoryPersister } from '../api/persist';
import { isRead } from '../api/remote/keys';
import { createRemoteApi } from '../api/remote/remoteApi';
import type { ChangeSignal, WireEntry, WireRequest } from '../api/remote/wire';
import { Store, type State } from '../api/store';
import { userCard } from '../api/views';
import { buildSeed } from '../data/seed';
import { sampleOffice } from '../data/sampleOffice';
import { CommentThread } from '../features/comments/CommentThread';
import { TaskRowItem } from '../features/project/tasks/TaskRowItem';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';
import { useUndoable } from './actions';
import { COLLECTION_KINDS } from './readMap';
import { RuntimeProvider, createQueryClient, useAction, useCall, type Runtime } from './runtime';
import type { ChangeListener, ChangeSource } from './signals';
import { ToastProvider } from './toasts';
import { WRITE_KINDS } from './writeKinds';

/**
 * The result of a save one round trip sooner (performance audit FET-3, owner plan a, 2026-10-08): the real RemoteApi, the change
 * rule and the screens, over a fake server that runs the prototype handlers of each request in order, as the batch route does.
 */

type Office = { userId: string; refuse?: (name: string) => boolean };

/** The real build of the screens over a fake server on the sample office. requests: the call names of each request, in order. */
async function remoteOffice(o: Office) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  state.session.currentUserId = o.userId;
  const store = new Store(state, memoryPersister());
  const office = createApi(calls, { store, latencyMs: 0, sampleOffice });
  const requests: string[][] = [];
  let seq = 0;
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as WireRequest;
    requests.push(body.calls.map((call) => call.name));
    const results: WireEntry[] = [];
    for (const call of body.calls) {
      if (o.refuse?.(call.name)) {
        results.push({ i: call.i, ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.' } });
        continue;
      }
      try {
        const result = await office.run(call.name as never, call.input as never);
        const entry: WireEntry = { i: call.i, ok: true, output: JSON.parse(JSON.stringify(result.output ?? null)), storyId: result.storyId, changed: result.changed };
        if (!isRead(call.name) && result.changed) {
          seq += 1;
          const signal: ChangeSignal = {
            v: 1, id: `sig-${seq}`, channel: 'office', seq, projects: [], office: true, kinds: [...(WRITE_KINDS[call.name] ?? COLLECTION_KINDS)],
            people: [o.userId], storyId: result.storyId, actorId: o.userId,
          };
          entry.signals = [signal];
        }
        results.push(entry);
      } catch (error) {
        const known = error instanceof ApiError ? error : new ApiError('failed', 'The call failed. Try again.');
        results.push({ i: call.i, ok: false, error: { code: known.code, message: known.message } });
      }
    }
    return new Response(JSON.stringify({ v: 1, serverTime: '', results }), { status: 200 });
  }) as typeof globalThis.fetch;
  const listeners = new Set<ChangeListener>();
  const changes: ChangeSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: () => 'open',
  };
  const api = createRemoteApi<Calls>({
    url: 'https://ref.supabase.co/functions/v1/api',
    build: 'test',
    token: async () => 'tok-1',
    fetch,
    onSignals: (signals, fresh) => {
      for (const listener of [...listeners]) {
        if (fresh) listener(signals, 'own', fresh);
        else listener(signals, 'own');
      }
    },
  });
  const runtime: Runtime = { api, changes, mode: 'remote' };
  const queryClient = createQueryClient({ remote: true });
  initI18n('en');
  const wrap = (ui: ReactNode) => (
    <RuntimeProvider runtime={runtime} queryClient={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </RuntimeProvider>
  );
  return { state, store, requests, queryClient, wrap };
}

/** Lets every request and every timer of the moment run (real timers). */
const quiet = () => act(() => new Promise((resolve) => { setTimeout(resolve, 60); }));

/** A task that this person may tick on the list of its project: open, with a lead, waiting for nothing. */
function tickable(state: State, userId: string): { id: string; projectId: string; title: string } {
  const task = Object.values(state.tasks).find((t) => t.projectId !== null && t.ownerId === userId && (t.status === 'todo' || t.status === 'in_progress')
    && state.projects[t.projectId]?.status === 'active' && (t.prerequisiteIds ?? []).length === 0)!;
  return { id: task.id, projectId: task.projectId!, title: task.title };
}

describe('a save shows its result with its own answer (performance audit FET-3)', () => {
  it('sends the reads on screen right after the write in its request, holds their new answers when the save ends, and asks nothing more', async () => {
    const office = await remoteOffice({ userId: 'usr_002' });
    const task = tickable(office.state, 'usr_002');
    const LIST = { projectId: task.projectId, activeProjectsOnly: false };
    const atSuccess: unknown[] = [];
    function Panel() {
      const detail = useCall('tasks.get', { id: task.id });
      const list = useCall('tasks.list', LIST);
      const complete = useAction('tasks.complete', {
        onSuccess: () => {
          const cached = office.queryClient.getQueryData<TaskDetail>(['api', 'tasks.get', { id: task.id }]);
          const rows = office.queryClient.getQueryData<TaskRow[]>(['api', 'tasks.list', LIST]);
          atSuccess.push([cached?.task.status, rows?.find((row) => row.task.id === task.id)?.task.status]);
        },
      });
      return (
        <>
          <p>Detail: {detail.data?.task.status}</p>
          <p>Rows: {list.data?.length}</p>
          <button type="button" onClick={() => complete.mutate({ id: task.id })}>Finish</button>
        </>
      );
    }
    render(office.wrap(<Panel />));
    expect(await screen.findByText(/^Detail: (todo|in_progress)$/)).toBeInTheDocument();
    await quiet();
    expect(office.requests).toEqual([['tasks.get', 'tasks.list']]);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(atSuccess).toHaveLength(1));
    const after = office.store.state.tasks[task.id].status;
    expect(['done', 'in_review']).toContain(after);
    // The cache held the answers of after the write when the success step ran.
    expect(atSuccess).toEqual([[after, after]]);
    expect(office.requests[1]).toEqual(['tasks.complete', 'tasks.get', 'tasks.list']);
    await quiet();
    // The own signals reload nothing more: both reads already hold the answer of after the write.
    expect(office.requests).toHaveLength(2);
    expect(screen.getByText(`Detail: ${after}`)).toBeInTheDocument();
  });

  it('keeps the filled circle of a ticked row until the row leaves the list (the circle no longer goes empty first)', async () => {
    const office = await remoteOffice({ userId: 'usr_002' });
    const task = tickable(office.state, 'usr_002');
    const LIST = { projectId: task.projectId, activeProjectsOnly: false };
    function List() {
      const session = useCall('session.get', {});
      const list = useCall('tasks.list', LIST);
      const rows = (list.data ?? []).filter((row) => row.task.status === 'todo' || row.task.status === 'in_progress');
      return <ul>{rows.map((row) => <TaskRowItem key={row.task.id} row={row} me={session.data?.user} onOpen={() => undefined} />)}</ul>;
    }
    const view = render(office.wrap(<List />));
    const tick = await screen.findByRole('checkbox', { name: `Complete ${task.title}` });
    await quiet();
    // Every state of the tick on screen, from each change of the page, until the row is gone.
    const states: string[] = [];
    const watch = new MutationObserver(() => {
      const box = within(view.container).queryByRole('checkbox', { name: `Complete ${task.title}` });
      const now = box ? String(box.getAttribute('aria-checked')) : 'gone';
      if (states.at(-1) !== now) states.push(now);
    });
    watch.observe(view.container, { subtree: true, childList: true, attributes: true });
    fireEvent.click(tick);
    await waitFor(() => expect(states.at(-1)).toBe('gone'), { timeout: 3000 });
    watch.disconnect();
    expect(states).toEqual(['true', 'gone']);
    expect(office.requests.at(-1)?.slice(0, 2)).toEqual(['tasks.complete', 'tasks.list']);
  });

  it('shows the new comment in the thread when the box clears', async () => {
    const office = await remoteOffice({ userId: 'usr_006' });
    const people = Object.values(office.state.users).map(userCard);
    const view = render(office.wrap(<CommentThread targetType="task" targetId="tsk_007" projectId="prj_001" people={people} canPost />));
    const box = await screen.findByRole('textbox', { name: 'Add a comment' });
    await quiet();
    await userEvent.type(box, 'The stair rail is fine');
    const states: string[] = [];
    const watch = new MutationObserver(() => {
      const shown = within(view.container).queryAllByText('The stair rail is fine').some((node) => node.tagName !== 'TEXTAREA');
      const now = `${(box as HTMLTextAreaElement).value === '' ? 'empty' : 'typed'}:${shown ? 'shown' : 'not shown'}`;
      if (states.at(-1) !== now) states.push(now);
    });
    watch.observe(view.container, { subtree: true, childList: true, attributes: true, characterData: true });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''), { timeout: 3000 });
    await quiet();
    watch.disconnect();
    expect(states).not.toContain('empty:not shown');
    expect(states.at(-1)).toBe('empty:shown');
    expect(office.requests.some((names) => names[0] === 'comments.create' && names.includes('comments.list'))).toBe(true);
  });

  it('a refused save still brings its reads back in the same request, shows its error, and asks nothing more', async () => {
    const office = await remoteOffice({ userId: 'usr_002', refuse: (name) => name === 'tasks.complete' });
    const task = tickable(office.state, 'usr_002');
    function Panel() {
      const detail = useCall('tasks.get', { id: task.id });
      const complete = useUndoable('tasks.complete', { message: () => 'Task done.' });
      return (
        <>
          <p>Detail: {detail.data?.task.status}</p>
          <button type="button" onClick={() => complete.mutate({ id: task.id })}>Finish</button>
        </>
      );
    }
    render(office.wrap(<Panel />));
    const before = office.store.state.tasks[task.id].status;
    expect(await screen.findByText(`Detail: ${before}`)).toBeInTheDocument();
    await quiet();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByText('Some fields are not valid.')).toBeInTheDocument();
    await quiet();
    expect(office.requests).toEqual([['tasks.get'], ['tasks.complete', 'tasks.get']]);
    expect(screen.getByText(`Detail: ${before}`)).toBeInTheDocument();
    expect(screen.queryByText('Task done.')).toBeNull();
  });

  it('leaves the prototype as before: the write goes alone, and no follow step runs', async () => {
    const follow = vi.fn();
    const call = vi.fn(async (name: string) => (name === 'tasks.get' ? { task: { status: 'todo' } } : { result: 'done' }));
    const run = vi.fn(async () => ({ output: { result: 'done' }, storyId: 'cor_1', changed: true }));
    const api = { call, run, follow } as unknown as MadarApi;
    function Panel() {
      useCall('tasks.get', { id: 'tsk_001' });
      const complete = useUndoable('tasks.complete', { message: () => 'Task done.' });
      const move = useAction('tasks.move');
      const [, setDone] = useState(0);
      return (
        <>
          <button type="button" onClick={() => complete.mutate({ id: 'tsk_001' }, { onSuccess: () => setDone((n) => n + 1) })}>Finish</button>
          <button type="button" onClick={() => move.mutate({ id: 'tsk_001', status: 'in_progress' })}>Start</button>
        </>
      );
    }
    initI18n('en');
    render(
      <RuntimeProvider runtime={{ api, mode: 'prototype' }} queryClient={createQueryClient()}>
        <ToastProvider><Panel /></ToastProvider>
      </RuntimeProvider>,
    );
    await quiet();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Task done.')).toBeInTheDocument();
    await quiet();
    expect(follow).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.filter(([name]) => name === 'tasks.move')).toHaveLength(1);
  });
});
