import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../api/contract/views';
import { useIsPhone } from '../../app/useIsPhone';
import { EmptyState } from '../../components/EmptyState';
import { TaskBoard } from '../project/tasks/TaskBoard';
import { boardRows } from './boardRows';

export type WorkBoardProps = {
  mine: TaskRow[]; review: TaskRow[]; done: TaskRow[];
  onOpen: (row: TaskRow) => void; onSendBack: (row: TaskRow) => void;
};

/**
 * The Board view of the Tasks screen (fbk_042, owner 2026-10-22): the project board with its four columns, over my to-dos of every
 * project and the office. It loads in its own chunk (the drag code of dnd-kit stays out of the first load, FL-2). It takes only plain
 * props and stable handlers, so a link change that only opens or closes the task panel does not render the cards again.
 * - The Done column holds the to-dos that I finished in the last 7 days.
 * - The to-dos that wait for my review sit in In review with "Your review". I approve with a move to Done.
 */
export const WorkBoard = memo(function WorkBoard({ mine, review, done, onOpen, onSendBack }: WorkBoardProps) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const rows = useMemo(() => boardRows(mine, review, done), [mine, review, done]);
  const reviewIds = useMemo(() => new Set(review.map((row) => row.task.id)), [review]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.task.id, row])), [rows]);
  // The review right is per card here: the project board has one flag for its whole project.
  const reviews = useMemo(() => (row: TaskRow) => reviewIds.has(row.task.id), [reviewIds]);
  if (rows.length === 0) return <EmptyState title={t('work.emptyTitle')} body={t('work.empty')} />;
  return (
    <TaskBoard
      rows={rows}
      reviews={reviews}
      across
      doneNote={phone ? t('phoneWork.board.doneRange') : undefined}
      onOpen={(taskId) => onOpen(byId.get(taskId)!)}
      onSendBack={(taskId) => onSendBack(byId.get(taskId)!)}
    />
  );
});
