import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CallInput, CallName } from '../api/calls';
import { useRuntime } from './runtime';

/**
 * Starts a read early, with the exact key and function of useCall, so the screen part that mounts it later finds the answer
 * in the cache and asks the server nothing (performance audit 2026-10-07, FET-1 and FET-2). Only the remote build prefetches:
 * the prototype reloads each read on mount (staleTime 0), so a prefetch there would load it twice.
 * Call the function in an effect, never in render. A cached answer that no change marked is not asked again.
 */
export function usePrefetchCall(): <N extends CallName>(name: N, input: CallInput<N>) => void {
  const runtime = useRuntime();
  const client = useQueryClient();
  return useCallback(
    <N extends CallName>(name: N, input: CallInput<N>) => {
      if (runtime.mode !== 'remote') return;
      void client.prefetchQuery({ queryKey: ['api', name, input], queryFn: () => runtime.api.call(name, input) });
    },
    [runtime, client],
  );
}
