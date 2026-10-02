import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput, MadarApi } from '../api/calls';
import type { Store } from '../api/store';
import { canRetry, errorMessage } from './errors';
import { useToast } from './toasts';

export type Runtime = { store: Store; api: MadarApi };

const RuntimeContext = createContext<Runtime | null>(null);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
  });
}

/** Refreshes every screen query after any change in the store, also after a scheduled notification. */
export function RuntimeProvider({ runtime, queryClient, children }: { runtime: Runtime; queryClient: QueryClient; children: ReactNode }) {
  useEffect(
    () => runtime.store.subscribe(() => {
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

export function useCall<N extends CallName>(name: N, input: CallInput<N>, options: { enabled?: boolean } = {}) {
  const { api } = useRuntime();
  return useQuery<CallOutput<N>>({ queryKey: ['api', name, input], queryFn: () => api.call(name, input), enabled: options.enabled ?? true });
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
        action: canRetry(error) ? { label: t('common.retry'), run: () => retry.current(input) } : undefined,
      });
    },
  });
  retry.current = mutation.mutate;
  return mutation;
}
