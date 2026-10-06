import { AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { User } from '../../api/contract/entities';
import type { TaskRow } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { todayISO } from '../../lib/dates';
import { groupMyTasks } from '../../lib/myWork';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { LoadFailed } from '../../components/LoadFailed';
import { openTask } from '../../lib/params';

function TaskGroup({ id, title, rows, me, onOpen }: { id: string; title: string; rows: TaskRow[]; me: User | undefined; onOpen: (row: TaskRow, thread?: boolean) => void }) {
  return (
    <section aria-labelledby={`work-${id}`} className="surface overflow-hidden rounded-card pb-2">
      <h2 id={`work-${id}`} className="px-4 pb-1 pt-3 text-headline">{title}</h2>
      <ul>
        <AnimatePresence initial={false}>
          {rows.map((row) => <TaskRowItem key={row.task.id} row={row} me={me} onOpen={(_, thread) => onOpen(row, thread)} showProject />)}
        </AnimatePresence>
      </ul>
    </section>
  );
}

/** My open tasks from all projects and the office, by date, with the leader's review queue first (spec 6.1). */
export function WorkTasks() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mine = useCall('tasks.list', { filter: 'mine', includeDone: false });
  const review = useCall('tasks.list', { filter: 'review_for_me' });
  // One session.get for every group. Each row takes the person from here.
  const me = useCall('session.get', {}).data?.authority;
  // An office task has no project, so its link names the task alone (owner, 2026-10-06).
  const open = (row: TaskRow, thread = false) => setParams((current) => openTask(current, row.task.id, row.project?.id ?? null, thread));
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    next.delete('thread');
    return next;
  }), [setParams]);
  if (mine.error || review.error) {
    return <LoadFailed error={mine.error ?? review.error} onRetry={() => { void mine.refetch(); void review.refetch(); }} />;
  }
  if (!mine.data || !review.data) return null;
  // One place for each thing (audit PER-10): a task in my review queue does not show again under its date.
  const inReview = new Set(review.data.map((row) => row.task.id));
  const groups = groupMyTasks(mine.data.filter((row) => !inReview.has(row.task.id)), todayISO());
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className="flex flex-col gap-5">
      {review.data.length > 0 && <TaskGroup id="review" title={t('work.group.review')} rows={review.data} me={me} onOpen={open} />}
      {groups.length === 0 && review.data.length === 0
        ? <EmptyState title={t('work.emptyTitle')} body={t('work.empty')} />
        : groups.map((group) => <TaskGroup key={group.group} id={group.group} title={t(`work.group.${group.group}`)} rows={group.rows} me={me} onOpen={open} />)}
      {taskId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
