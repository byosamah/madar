import { AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { todayISO } from '../../lib/dates';
import { groupMyTasks } from '../../lib/myWork';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { LoadFailed } from '../../components/LoadFailed';

function TaskGroup({ id, title, rows, onOpen }: { id: string; title: string; rows: TaskRow[]; onOpen: (row: TaskRow) => void }) {
  return (
    <section aria-labelledby={`work-${id}`} className="surface overflow-hidden rounded-card pb-2">
      <h2 id={`work-${id}`} className="px-4 pb-1 pt-3 text-headline">{title}</h2>
      <ul>
        <AnimatePresence initial={false}>
          {rows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={() => onOpen(row)} showProject />)}
        </AnimatePresence>
      </ul>
    </section>
  );
}

/** My open tasks from all projects, by date, with the leader's review queue first (spec 6.1). */
export function WorkTasks() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mine = useCall('tasks.list', { filter: 'mine', includeDone: false });
  const review = useCall('tasks.list', { filter: 'review_for_me' });
  const open = (row: TaskRow) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', row.task.id);
    next.set('project', row.project.id);
    return next;
  });
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    return next;
  }), [setParams]);
  if (mine.error || review.error) {
    return <LoadFailed error={mine.error ?? review.error} onRetry={() => { void mine.refetch(); void review.refetch(); }} />;
  }
  if (!mine.data || !review.data) return null;
  const groups = groupMyTasks(mine.data, todayISO());
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className="flex flex-col gap-5">
      {review.data.length > 0 && <TaskGroup id="review" title={t('work.group.review')} rows={review.data} onOpen={open} />}
      {groups.length === 0 && review.data.length === 0
        ? <EmptyState title={t('work.emptyTitle')} body={t('work.empty')} />
        : groups.map((group) => <TaskGroup key={group.group} id={group.group} title={t(`work.group.${group.group}`)} rows={group.rows} onOpen={open} />)}
      {taskId && projectId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
