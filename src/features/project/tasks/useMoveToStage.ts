import { useTranslation } from 'react-i18next';
import { useUndoable } from '../../../app/actions';

/**
 * The move of a to-do to another stage on the board of a continuous project (fbk_085): one tasks.update with patch.stageId, with an Undo
 * toast. A continuous project asks no reason for a move to an earlier stage (fbk_084), so no question can come back.
 * It has a file of its own: `useTaskMoves.ts` is in the first load (the task row), and a hook of the lazy board there joins the first load too.
 */
export function useMoveToStage() {
  const { t } = useTranslation();
  return useUndoable('tasks.update', { message: (output) => t('tasks.movedToStage', { stage: output.stage?.name ?? '' }) });
}
