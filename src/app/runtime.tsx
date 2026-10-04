import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, keepPreviousData, type MutateOptions } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput, MadarApi } from '../api/calls';
import { AttemptKeys } from '../api/remote/keys';
import type { Store } from '../api/store';
import type { AuthPort } from './auth';
import { canRetry, errorMessage } from './errors';
import { READS } from './readMap';
import { connectChanges, type ChangeSource } from './signals';
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

/**
 * remote: a read keeps its answer until a change signal names it (plan R2), so a screen that opens again shows the cached list
 * at once and asks the server nothing. A read that never reloads on a signal (a signed link, a screenshot, the usage meters)
 * still loads each time a screen opens it. The prototype reloads every list after each change and on each mount, as before.
 */
export function createQueryClient(o: { remote?: boolean } = {}): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
  });
  if (o.remote) {
    client.setQueryDefaults(['api'], { staleTime: Infinity });
    for (const [name, rule] of Object.entries(READS)) if (rule.scope === 'none') client.setQueryDefaults(['api', name], { staleTime: 0 });
  }
  return client;
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

/** Reloads the screen queries that a change touches (src/app/signals.ts): all of them for each change of the prototype store. */
export function RuntimeProvider({ runtime, queryClient, children }: { runtime: Runtime; queryClient: QueryClient; children: ReactNode }) {
  useEffect(() => {
    const source = changesOf(runtime);
    if (!source) return undefined;
    return connectChanges(queryClient, source, () => personOf(queryClient));
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
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  const latest = useRef(options);
  latest.current = options;
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const attempts = useAttemptKeys();
  const mutation = useMutation<CallOutput<N>, unknown, CallInput<N>>({
    mutationKey: ['api', name],
    mutationFn: (input) => attempts.run(input, (key) => api.call(name, input, { key })),
    onSuccess: (output) => options.onSuccess?.(output),
    onError: (error, input) => {
      if (latest.current.onRefused?.(error, input)) return;
      toast.show({
        tone: 'error',
        message: errorMessage(error, t),
        action: canRetry(error) ? { label: t('common.retry'), run: () => retry.current(input), isUndo: false } : undefined,
      });
    },
  });
  const steps = useRetryableMutate(mutation.mutate, attempts);
  retry.current = steps.retry;
  return { ...mutation, mutate: steps.mutate };
}
