import { useTranslation } from 'react-i18next';
import type { CallOutput } from '../../../api/calls';
import { useUndoable } from '../../../app/actions';
import type { useStageBack } from './StageBack';

/**
 * The move of a to-do to another column or stage, with its Undo toast. The words come from the server result, so the toast is true
 * also when the caller guessed the target. `back` is the caller's own `useStageBack()`: the server may ask why a move goes back.
 */
export function useMoveTask(back: Pick<ReturnType<typeof useStageBack>, 'refused'>) {
  const { t } = useTranslation();
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
    onRefused: (error, input) => back.refused(error, input, (next) => move.mutate(next)),
  });
  return move;
}

/** The finish of a to-do, with its Undo toast. The server result decides the words: a to-do that needs review goes to review. */
export function useCompleteTask(options: { onSuccess?: (output: CallOutput<'tasks.complete'>) => void } = {}) {
  const { t } = useTranslation();
  return useUndoable('tasks.complete', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')),
    ...options,
  });
}
