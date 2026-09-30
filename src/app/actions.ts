import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput } from '../api/calls';
import { canRetry, errorMessage } from './errors';
import { useRuntime } from './runtime';
import { useToast } from './toasts';

/** A story ID for one action on screen. Every change the action makes carries it, so one Undo reverses them all. */
export function newStoryId(): string {
  return `cor_ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Runs a change and offers Undo for 5 seconds (spec 5.5 and 11.5). A failed call offers Retry (spec 11.6). */
export function useUndoable<N extends CallName>(
  name: N,
  options: { message: (output: CallOutput<N>) => string; onSuccess?: (output: CallOutput<N>) => void },
) {
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  const latest = useRef(options);
  latest.current = options;
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const mutation = useMutation<{ output: CallOutput<N>; storyId: string }, unknown, CallInput<N>>({
    mutationFn: async (input) => {
      const storyId = newStoryId();
      return { output: await api.call(name, input, { correlationId: storyId }), storyId };
    },
    onSuccess: ({ output, storyId }) => {
      latest.current.onSuccess?.(output);
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
    onError: (error, input) => toast.show({
      tone: 'error',
      message: errorMessage(error, t),
      action: canRetry(error) ? { label: t('common.retry'), run: () => retry.current(input) } : undefined,
    }),
  });
  retry.current = mutation.mutate;
  return mutation;
}
