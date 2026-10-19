import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient, keepPreviousData, type MutateOptions, type Query,
} from '@tanstack/react-query';
import type { CallInput, CallName, CallOutput, MadarApi } from '../api/calls';
import { canFollow } from '../api/remote/follow';
import { AttemptKeys } from '../api/remote/keys';
import type { Store } from '../api/store';
import { addDays, todayISO } from '../lib/dates';
import type { AuthPort } from './auth';
import { READS } from './readMap';
import { connectChanges, followMeta, readsAfterWrite, type ChangeSource } from './signals';
import { useToast } from './toasts';

/**
 * Where change signals come from (plan 5.3): Realtime in the real build, the store in the prototype. An empty list means
 * "something changed, reload all". src/app/signals.ts holds the reload rules.
 */
export type { ChangeListener, ChangeOrigin, ChangeSource } from './signals';

/**
 * The prototype fills every part. The real build has no store (src/app/remote/bootstrap.ts). A test may pass only { store, api }:
 * the store then sends the change signals, as in the prototype.
 */
export type Runtime = { store?: Store; api: MadarApi; auth?: AuthPort; changes?: ChangeSource; mode?: 'prototype' | 'remote' };

const RuntimeContext = createContext<Runtime | null>(null);

/** How long the real build keeps an answer that no screen shows (performance audit FET-5). */
export const KEEP_MS = 60 * 60_000;
/** The life of an answer that no screen shows, as before FET-5: a signed link, a search, an answer that a change marked. */
export const SHORT_MS = 5 * 60_000;

/**
 * remote: a read keeps its answer until a change signal names it (plan R2), so a screen that opens again shows the cached list
 * at once and asks the server nothing. An answer that no screen shows stays for an hour (keepAnswers has the two exceptions).
 * A read that never reloads on a signal (a signed link, a screenshot, the usage meters) still loads each time a screen opens it,
 * and it goes 5 minutes after its screen closed, as does a search (one answer for each typed text). The prototype reloads
 * every list after each change and on each mount, as before.
 */
export function createQueryClient(o: { remote?: boolean } = {}): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
  });
  if (o.remote) {
    // The specific defaults come after the general one: TanStack merges them in this order.
    client.setQueryDefaults(['api'], { staleTime: Infinity, gcTime: KEEP_MS });
    for (const [name, rule] of Object.entries(READS)) if (rule.scope === 'none') client.setQueryDefaults(['api', name], { staleTime: 0, gcTime: SHORT_MS });
    client.setQueryDefaults(['api', 'search.query'], { gcTime: SHORT_MS });
  }
  return client;
}

/** The time from a moment to the start of the next office day (the day of the screens, todayISO). */
function msToNextDay(at: number): number {
  return Date.parse(`${addDays(todayISO(new Date(at)), 1)}T00:00:00.000+03:00`) - at;
}

/**
 * The two exceptions to the hour of the real build (performance audit FET-5). Returns the stop.
 * - An answer that a change marked goes 5 minutes after its last screen closed (or after its last load), as before. So a screen
 *   that opens later never shows a list that a change made old.
 * - When the office day changes, every answer that no screen shows goes, so no count of yesterday ("due today", "2 days past
 *   due") comes back. The check runs at midnight and when the tab shows again, because a sleeping computer runs no timer.
 * A screen that shows an answer keeps it, as before. A sign-out resets the whole cache (useLeaveScreen).
 */
export function keepAnswers(queryClient: QueryClient): () => void {
  const cache = queryClient.getQueryCache();
  /** When each answer lost its last screen. */
  const lostAt = new WeakMap<Query, number>();
  const timers = new Map<Query, ReturnType<typeof setTimeout>>();
  const isApi = (query: Query) => query.queryKey[0] === 'api';
  const unseen = (query: Query) => query.getObserversCount() === 0;

  const cancel = (query: Query) => {
    const timer = timers.get(query);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(query);
  };
  /** The last of: the close of its last screen, the end of its last load. TanStack counts its own gcTime from the same moments. */
  const idleSince = (query: Query) => Math.max(lostAt.get(query) ?? 0, query.state.dataUpdatedAt, query.state.errorUpdatedAt);

  /** Starts the wait of a marked answer that no screen shows, once. A load that runs ends the wait itself (its end tells again). */
  function check(query: Query): void {
    if (!unseen(query) || !query.state.isInvalidated) {
      cancel(query);
      return;
    }
    if (timers.has(query)) return;
    timers.set(query, setTimeout(() => {
      timers.delete(query);
      if (!unseen(query) || !query.state.isInvalidated || query.state.fetchStatus !== 'idle' || cache.get(query.queryHash) !== query) return;
      if (Date.now() - idleSince(query) >= SHORT_MS) cache.remove(query);
      else check(query);
    }, Math.max(0, idleSince(query) + SHORT_MS - Date.now())));
  }

  const unsubscribe = cache.subscribe((event) => {
    const { query } = event;
    if (!isApi(query)) return;
    if (event.type === 'removed') {
      cancel(query);
      return;
    }
    if (event.type === 'observerRemoved' && unseen(query)) lostAt.set(query, Date.now());
    if (event.type === 'observerRemoved' || event.type === 'observerAdded' || event.type === 'updated') check(query);
  });

  let day = todayISO();
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  const newDay = () => {
    const today = todayISO();
    if (today === day) return;
    day = today;
    queryClient.removeQueries({ queryKey: ['api'], predicate: unseen });
  };
  const atMidnight = () => {
    // One second after midnight, so a timer that fires a little early still sees the new day.
    dayTimer = setTimeout(() => {
      newDay();
      atMidnight();
    }, msToNextDay(Date.now()) + 1000);
  };
  atMidnight();
  const onVisibility = () => {
    if (typeof document !== 'undefined' && !document.hidden) newDay();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return () => {
    unsubscribe();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    if (dayTimer !== undefined) clearTimeout(dayTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** The change signals of a runtime: its own source, or for a runtime with only a store, one "reload all" for each store change. */
function changesOf(runtime: Runtime): ChangeSource | undefined {
  if (runtime.changes) return runtime.changes;
  const { store } = runtime;
  if (!store) return undefined;
  return { subscribe: (listener) => store.subscribe(() => listener([])), status: () => 'open' };
}

/** The person on this screen, from the cached session ('' before it loads). Only personal changes need it. */
function personOf(queryClient: QueryClient): string {
  const session = queryClient.getQueryData<{ user?: { id?: string } }>(['api', 'session.get', {}]);
  return session?.user?.id ?? '';
}

/**
 * Reloads the screen queries that a change touches (src/app/signals.ts): all of them for each change of the prototype store.
 * The real build also keeps the answers of closed screens by the rules of keepAnswers.
 */
export function RuntimeProvider({ runtime, queryClient, children }: { runtime: Runtime; queryClient: QueryClient; children: ReactNode }) {
  useEffect(() => {
    const source = changesOf(runtime);
    const stopChanges = source ? connectChanges(queryClient, source, () => personOf(queryClient)) : undefined;
    const stopKeep = runtime.mode === 'remote' ? keepAnswers(queryClient) : undefined;
    return () => {
      stopChanges?.();
      stopKeep?.();
    };
  }, [runtime, queryClient]);
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is missing.');
  return runtime;
}

/** How long the success steps of an action wait at most for a read of its follow step that went in another request (FET-3). */
export const FOLLOW_WAIT_MS = 50;

/** Resolves when every promise has settled, or after ms at most. The promises never reject. */
function settledWithin(promises: Promise<unknown>[], ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void Promise.all(promises).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * A write of the real build with the reads on screen that it will change (performance audit FET-3, owner plan a, 2026-10-08).
 * The reads go in the request of the write, right after it (RemoteApi follow step), so the result of a save shows with its own
 * answer, one round trip sooner. Nothing shows before the server answers. The success steps of the action (the end of the tick
 * of a row, the clear of a comment box) run after the screen shows the new answers: after the reads, and one task later,
 * because TanStack tells the screen on the next task. A refused write throws at once; its reads still bring the current data.
 * The prototype, and an api with no follow step, send the write alone, as before.
 */
export async function writeWithReads<T>(runtime: Runtime, queryClient: QueryClient, name: string, input: unknown, write: () => Promise<T>): Promise<T> {
  const { api } = runtime;
  if (runtime.mode !== 'remote' || !canFollow(api)) return write();
  const chosen = readsAfterWrite(queryClient, name, input, personOf(queryClient));
  if (chosen.length === 0) return write();
  const tag = {};
  const loads: Promise<unknown>[] = [];
  // The write goes on the wire first, then each read: the follow step puts them behind it in its request.
  const result = await api.follow(write, () => {
    for (const query of chosen) loads.push(query.fetch(undefined, { cancelRefetch: true, meta: followMeta(tag) }).catch(() => undefined));
  }, tag);
  if (loads.length > 0) {
    await settledWithin(loads, FOLLOW_WAIT_MS);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return result;
}

/** keepPrevious: while a new input loads, the screen keeps showing the last answer, so a list never blanks out between key presses. */
export function useCall<N extends CallName>(name: N, input: CallInput<N>, options: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  const { api } = useRuntime();
  return useQuery<CallOutput<N>>({
    queryKey: ['api', name, input],
    queryFn: () => api.call(name, input),
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
  });
}

/**
 * A mutate that remembers the steps a screen passed with each call (for example "clear the box" after a send), so the Retry
 * of a failed call runs them too. Without them a Retry posted the message but left it in the box (audit 2026-10-03, SHL-10).
 * With "attempts", each new call gets a new idempotency key and a Retry gets the key of the failed attempt (plan 4.10).
 */
export function useRetryableMutate<TData, TInput>(
  mutate: (input: TInput, options?: MutateOptions<TData, unknown, TInput>) => void,
  attempts?: AttemptKeys,
): { mutate: (input: TInput, options?: MutateOptions<TData, unknown, TInput>) => void; retry: (input: TInput) => void } {
  const steps = useRef(new WeakMap<object, MutateOptions<TData, unknown, TInput>>());
  const remember = useCallback((input: TInput, options?: MutateOptions<TData, unknown, TInput>) => {
    if (options && typeof input === 'object' && input !== null) steps.current.set(input, options);
    attempts?.fresh(input);
    mutate(input, options);
  }, [mutate, attempts]);
  const retry = useCallback((input: TInput) => {
    attempts?.again(input);
    mutate(input, typeof input === 'object' && input !== null ? steps.current.get(input) : undefined);
  }, [mutate, attempts]);
  return { mutate: remember, retry };
}

/** The idempotency keys of one action hook, kept for the life of the screen. */
export function useAttemptKeys(): AttemptKeys {
  const keys = useRef<AttemptKeys | null>(null);
  keys.current ??= new AttemptKeys();
  return keys.current;
}

export function useAction<N extends CallName>(
  name: N,
  options: { onSuccess?: (output: CallOutput<N>) => void; onRefused?: (error: unknown, input: CallInput<N>) => boolean } = {},
) {
  const runtime = useRuntime();
  const { api } = runtime;
  const queryClient = useQueryClient();
  const toast = useToast();
  const latest = useRef(options);
  latest.current = options;
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const attempts = useAttemptKeys();
  const mutation = useMutation<CallOutput<N>, unknown, CallInput<N>>({
    mutationKey: ['api', name],
    // The real build sends the reads that the write changes right after it (FET-3, writeWithReads).
    mutationFn: (input) => attempts.run(input, (key) => writeWithReads(runtime, queryClient, name, input, () => api.call(name, input, { key }))),
    onSuccess: (output) => options.onSuccess?.(output),
    onError: (error, input) => {
      if (latest.current.onRefused?.(error, input)) return;
      toast.failed(error, { retry: () => retry.current(input) });
    },
  });
  const steps = useRetryableMutate(mutation.mutate, attempts);
  retry.current = steps.retry;
  // retry(input) sends the same input again with the options and the idempotency key of its failed attempt (the "Send again" of a message).
  return { ...mutation, mutate: steps.mutate, retry: steps.retry };
}
