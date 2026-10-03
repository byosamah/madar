import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, keepPreviousData, type MutateOptions } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput, MadarApi } from '../api/calls';
import type { ChangeSignal } from '../api/remote/wire';
import type { Store } from '../api/store';
import type { AuthPort } from './auth';
import { canRetry, errorMessage } from './errors';
import { useToast } from './toasts';

/**
 * Where change signals come from (plan 5.3): Realtime in the real build, the store in the prototype. An empty list means
 * "something changed, reload all". Track R2 adds the reload rules in src/app/signals.ts.
 */
export type ChangeSource = { subscribe(listener: (signals: ChangeSignal[]) => void): () => void; status(): 'open' | 'closed' };

/** The prototype fills every part. The real build has no store; track R2 fills the rest from src/app/remote/bootstrap.ts. */
export type Runtime = { store?: Store; api: MadarApi; auth?: AuthPort; changes?: ChangeSource; mode?: 'prototype' | 'remote' };

const RuntimeContext = createContext<Runtime | null>(null);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
  });
}

/** Refreshes every screen query after any change in the store, also after a scheduled notification. */
export function RuntimeProvider({ runtime, queryClient, children }: { runtime: Runtime; queryClient: QueryClient; children: ReactNode }) {
  useEffect(
    () => runtime.store?.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ['api'] });
    }),
    [runtime, queryClient],
  );
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
 */
export function useRetryableMutate<TData, TInput>(
  mutate: (input: TInput, options?: MutateOptions<TData, unknown, TInput>) => void,
): { mutate: (input: TInput, options?: MutateOptions<TData, unknown, TInput>) => void; retry: (input: TInput) => void } {
  const steps = useRef(new WeakMap<object, MutateOptions<TData, unknown, TInput>>());
  const remember = useCallback((input: TInput, options?: MutateOptions<TData, unknown, TInput>) => {
    if (options && typeof input === 'object' && input !== null) steps.current.set(input, options);
    mutate(input, options);
  }, [mutate]);
  const retry = useCallback((input: TInput) => {
    mutate(input, typeof input === 'object' && input !== null ? steps.current.get(input) : undefined);
  }, [mutate]);
  return { mutate: remember, retry };
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
  const mutation = useMutation<CallOutput<N>, unknown, CallInput<N>>({
    mutationKey: ['api', name],
    mutationFn: (input) => api.call(name, input),
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
  const steps = useRetryableMutate(mutation.mutate);
  retry.current = steps.retry;
  return { ...mutation, mutate: steps.mutate };
}
