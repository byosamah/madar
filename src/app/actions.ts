import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput } from '../api/calls';
import { canRetry, errorMessage } from './errors';
import { useRetryableMutate, useRuntime } from './runtime';
import { useToast } from './toasts';

/** A story ID for one action on screen. Every change the action makes carries it, so one Undo reverses them all. */
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
  },
) {
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  const latest = useRef(options);
  latest.current = options;
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const mutation = useMutation<{ output: CallOutput<N>; storyId: string }, unknown, CallInput<N>>({
    mutationKey: ['api', name],
    mutationFn: async (input) => {
      const storyId = newStoryId();
      return { output: await api.call(name, input, { correlationId: storyId }), storyId };
    },
    onSuccess: async ({ output, storyId }) => {
      latest.current.onSuccess?.(output);
      // An action that changed nothing gets no toast: there is nothing to report and nothing to undo.
      // When this check itself fails, the change still happened, so the toast and its Undo still show.
      const changes = await api.call('events.list', { correlationId: storyId, limit: 1 }).catch(() => null);
      if (changes?.length === 0) return;
      toast.show({
        message: latest.current.message(output),
        action: {
          label: t('common.undo'),
          run: () => {
            api.call('events.undoStory', { correlationId: storyId }).catch((error: unknown) => {
              toast.show({ tone: 'error', message: errorMessage(error, t) });
            });
          },
        },
      });
    },
    onError: (error, input) => {
      if (latest.current.onRefused?.(error, input)) return;
      toast.show({
        tone: 'error',
        message: errorMessage(error, t),
        action: canRetry(error) ? { label: t('common.retry'), run: () => retry.current(input) } : undefined,
      });
    },
  });
  const steps = useRetryableMutate(mutation.mutate);
  retry.current = steps.retry;
  return { ...mutation, mutate: steps.mutate };
}
