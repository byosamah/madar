import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CallInput, CallName, CallOutput } from '../api/calls';
import type { CallResult } from '../api/client';
import { useAttemptKeys, useRetryableMutate, useRuntime, writeWithReads } from './runtime';
import { useToast } from './toasts';

/**
 * A story ID for one action on screen. Every change the action makes carries it, so one Undo reverses them all.
 * In the real build it is a placeholder: RemoteApi maps it to the story that the server makes (client map 2.4).
 */
export function newStoryId(): string {
  return `cor_ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Runs a change and offers Undo for 5 seconds (spec 5.5 and 11.5). A failed call offers Retry (spec 11.6). */
export function useUndoable<N extends CallName>(
  name: N,
  options: {
    message: (output: CallOutput<N>) => string;
    onSuccess?: (output: CallOutput<N>) => void;
    /** A screen that answers a refusal itself (it asks a question, then calls again) returns true, and no error toast shows. */
    onRefused?: (error: unknown, input: CallInput<N>) => boolean;
    /** A step outside the story that Undo also takes back, for example a read mark (audit 2026-10-03, V-16). */
    onUndo?: () => void;
  },
) {
  const runtime = useRuntime();
  const { api } = runtime;
  const queryClient = useQueryClient();
  const toast = useToast();
  const latest = useRef(options);
  latest.current = options;
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const attempts = useAttemptKeys();
  const mutation = useMutation<CallResult<CallOutput<N>>, unknown, CallInput<N>>({
    mutationKey: ['api', name],
    // run() returns the story that the call used (the server makes it in the real build) and whether it changed a record,
    // so no second call is needed. A Retry sends the idempotency key of the failed attempt again (plan 4.10). The real build
    // sends the reads that the write changes right after it (performance audit FET-3, writeWithReads).
    mutationFn: (input) => attempts.run(input, (key) => writeWithReads(runtime, queryClient, name, input, () => api.run(name, input, { key }))),
    onSuccess: ({ output, storyId, changed }) => {
      latest.current.onSuccess?.(output);
      // An action that changed nothing gets no toast: there is nothing to report and nothing to undo.
      if (!changed) return;
      toast.undo(latest.current.message(output), () => {
        api.call('events.undoStory', { correlationId: storyId }).then(() => latest.current.onUndo?.(), (error: unknown) => toast.failed(error));
      });
    },
    onError: (error, input) => {
      if (latest.current.onRefused?.(error, input)) return;
      toast.failed(error, { retry: () => retry.current(input) });
    },
  });
  const steps = useRetryableMutate(mutation.mutate, attempts);
  retry.current = steps.retry;
  return { ...mutation, mutate: steps.mutate };
}
