import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { watchCalls, watchRoutes } from './watch';
import type { InsightClient } from './notes';

/** A router that holds a location and tells its listeners. */
function fakeRouter(path: string, search = '') {
  const listeners = new Set<(state: { location: { pathname: string; search: string } }) => void>();
  const router = { state: { location: { pathname: path, search } }, subscribe: (listener: (state: { location: { pathname: string; search: string } }) => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  return { router: router as never, go: (pathname: string, next = '') => { router.state = { location: { pathname, search: next } }; listeners.forEach((listener) => listener(router.state)); }, listeners };
}

describe('watchRoutes', () => {
  it('sends one page view at the start and one for each change of the path or of the tab', () => {
    const track = vi.fn();
    const r = fakeRouter('/projects/prj_1', '?tab=tasks&task=tsk_9');
    watchRoutes(r.router, track);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenLastCalledWith('$pageview', expect.objectContaining({ screen: 'project', tab: 'tasks' }));
    expect(track.mock.calls[0]![1].$current_url).toBe(`${window.location.origin}/projects/prj_1?tab=tasks`);
    r.go('/projects/prj_1', '?tab=files');
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith('$pageview', expect.objectContaining({ screen: 'project', tab: 'files' }));
    r.go('/inbox');
    expect(track).toHaveBeenCalledTimes(3);
    expect(track).toHaveBeenLastCalledWith('$pageview', expect.objectContaining({ screen: 'inbox' }));
    expect(track.mock.calls[2]![1]).not.toHaveProperty('tab');
  });

  it('names Home "home": its screen sits in the first script, so the screen table has no name for /', () => {
    const track = vi.fn();
    const r = fakeRouter('/');
    watchRoutes(r.router, track);
    expect(track).toHaveBeenLastCalledWith('$pageview', expect.objectContaining({ screen: 'home' }));
  });

  it('sends nothing when only another query value changes, and nothing after the stop', () => {
    const track = vi.fn();
    const r = fakeRouter('/projects/prj_1', '?tab=tasks');
    const stop = watchRoutes(r.router, track);
    r.go('/projects/prj_1', '?tab=tasks&task=tsk_2');
    r.go('/projects/prj_1', '?tab=tasks&task=tsk_3&q=secret');
    expect(track).toHaveBeenCalledTimes(1);
    stop();
    expect(r.listeners.size).toBe(0);
    r.go('/inbox');
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('never sends a query value other than the tab, a hash or a Google code', () => {
    const track = vi.fn();
    watchRoutes(fakeRouter('/settings', '?q=secret#google=finish&code=abc&state=def').router, track);
    const props = track.mock.calls[0]![1] as Record<string, string>;
    expect(JSON.stringify(props)).not.toMatch(/secret|code=|state=/);
  });
});

describe('watchCalls', () => {
  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const client = { track: vi.fn(), exception: vi.fn(), stop: vi.fn() } as InsightClient & { track: ReturnType<typeof vi.fn>; exception: ReturnType<typeof vi.fn> };
    let t = 1_000_000;
    const stop = watchCalls(queryClient, client, () => t);
    return { queryClient, client, stop, advance: (ms: number) => { t += ms; } };
  }
  const failQuery = async (queryClient: QueryClient, key: unknown[], error: unknown) => {
    await queryClient.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(error), retry: false }).catch(() => undefined);
  };
  const failMutation = async (queryClient: QueryClient, key: unknown[], error: unknown) => {
    await queryClient.getMutationCache().build(queryClient, { mutationKey: key, mutationFn: () => Promise.reject(error) }).execute(undefined).catch(() => undefined);
  };

  it('a refusal with a reason gives madar_refused with the call, the code and the reason, and no person', async () => {
    const { queryClient, client } = setup();
    await failQuery(queryClient, ['api', 'tasks.update', { id: 'tsk_1', title: 'Secret title' }], new ApiError('conflict', 'This week is locked.', { reason: 'week_locked' }));
    expect(client.track).toHaveBeenCalledTimes(1);
    expect(client.track).toHaveBeenCalledWith('madar_refused', { call: 'tasks.update', code: 'conflict', reason: 'week_locked' });
    expect(JSON.stringify(client.track.mock.calls)).not.toMatch(/Secret|usr_1|Alice/);
  });

  it('a refusal of a write is counted too', async () => {
    const { queryClient, client } = setup();
    await failMutation(queryClient, ['api', 'tasks.complete'], new ApiError('forbidden', 'No lead.', { reason: 'needs_lead' }));
    expect(client.track).toHaveBeenCalledWith('madar_refused', { call: 'tasks.complete', code: 'forbidden', reason: 'needs_lead' });
  });

  it('a refusal with no reason gives nothing', async () => {
    const { queryClient, client } = setup();
    await failQuery(queryClient, ['api', 'projects.get', { id: 'x' }], new ApiError('not_found', 'Gone.'));
    expect(client.track).not.toHaveBeenCalled();
  });

  it('a failed call gives madar_call_failed with the call name only, and no person (owner, 2026-10-28, tsk_489)', async () => {
    const { queryClient, client } = setup();
    await failMutation(queryClient, ['api', 'chats.send'], new ApiError('failed', 'The call failed. Try again.'));
    expect(client.track).toHaveBeenCalledWith('madar_call_failed', { call: 'chats.send' });
    expect(JSON.stringify(client.track.mock.calls)).not.toMatch(/usr_1|Alice|person/);
  });

  it('a failed query gives the same record: the call name only', async () => {
    const { queryClient, client } = setup();
    await failQuery(queryClient, ['api', 'tasks.list', {}], new ApiError('failed', 'x'));
    expect(client.track).toHaveBeenCalledWith('madar_call_failed', { call: 'tasks.list' });
  });

  it('the same failed call is counted once in 5 seconds, so a lost network is not a flood', async () => {
    const { queryClient, client, advance } = setup();
    await failQuery(queryClient, ['api', 'tasks.list', { a: 1 }], new ApiError('failed', 'x'));
    await failQuery(queryClient, ['api', 'tasks.list', { a: 2 }], new ApiError('failed', 'x'));
    expect(client.track).toHaveBeenCalledTimes(1);
    advance(5_001);
    await failQuery(queryClient, ['api', 'tasks.list', { a: 3 }], new ApiError('failed', 'x'));
    expect(client.track).toHaveBeenCalledTimes(2);
  });

  it('unauthenticated gives nothing', async () => {
    const { queryClient, client } = setup();
    await failQuery(queryClient, ['api', 'tasks.list', {}], new ApiError('unauthenticated', 'x'));
    await failMutation(queryClient, ['api', 'chats.send'], new ApiError('unauthenticated', 'x'));
    expect(client.track).not.toHaveBeenCalled();
    expect(client.exception).not.toHaveBeenCalled();
  });

  it('a plain Error gives an exception with the call name', async () => {
    const { queryClient, client } = setup();
    const error = new TypeError('x is not a function');
    await failQuery(queryClient, ['api', 'projects.list', {}], error);
    expect(client.exception).toHaveBeenCalledWith(error, { where: 'call', call: 'projects.list' });
    expect(client.track).not.toHaveBeenCalled();
  });

  it('leaves out a query that is no call, and gives nothing after the stop', async () => {
    const { queryClient, client, stop } = setup();
    await failQuery(queryClient, ['file-link', 'fil_1'], new ApiError('failed', 'x'));
    expect(client.track).not.toHaveBeenCalled();
    stop();
    await failQuery(queryClient, ['api', 'tasks.list', {}], new ApiError('failed', 'x'));
    expect(client.track).not.toHaveBeenCalled();
  });

  afterEach(() => vi.restoreAllMocks());
});
