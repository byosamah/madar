import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { User } from '../../api/contract/entities';
import type { TaskRow } from '../../api/contract/views';
import { useCall, useRuntime } from '../../app/runtime';
import { useStableHandler } from '../../app/useStableHandler';
import { EmptyState } from '../../components/EmptyState';
import { todayISO } from '../../lib/dates';
import { groupMyTasks } from '../../lib/myWork';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { SortableTaskRows } from '../project/tasks/SortableTaskRows';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { LoadFailed } from '../../components/LoadFailed';
import { openTask } from '../../lib/params';
import { homePlaceholder } from './minePlaceholder';

type Open = (row: TaskRow, thread?: boolean) => void;

function TaskGroup({ id, title, rows, me, onOpen }: { id: string; title: string; rows: TaskRow[]; me: User | undefined; onOpen: Open }) {
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

/**
 * A date group whose tasks a person drags into a new order (owner, 2026-10-07). A drag never leaves the group and never changes a
 * date (`SortableTaskRows`).
 */
function SortableGroup({ id, title, rows, me, onOpen }: { id: string; title: string; rows: TaskRow[]; me: User | undefined; onOpen: Open }) {
  return (
    <section aria-labelledby={`work-${id}`} className="surface rounded-card pb-2">
      <h2 id={`work-${id}`} className="px-4 pb-1 pt-3 text-headline">{title}</h2>
      <SortableTaskRows rows={rows} me={me} onOpen={onOpen} showProject />
    </section>
  );
}

/**
 * The review group, the date groups and the empty state. It takes only plain props and stable handlers, so a link change that
 * only opens or closes the task panel does not render the rows again (performance audit 2026-10-07, RND-2). "today" comes
 * from the parent, so a new day still gives new date groups and due words.
 */
const WorkBody = memo(function WorkBody({ mine, review, me, today, onOpen }: {
  mine: TaskRow[]; review: TaskRow[]; me: User | undefined; today: string; onOpen: Open;
}) {
  const { t } = useTranslation();
  // One place for each thing (audit PER-10): a task in my review queue does not show again under its date.
  const groups = useMemo(() => {
    const inReview = new Set(review.map((row) => row.task.id));
    return groupMyTasks(mine.filter((row) => !inReview.has(row.task.id)), today);
  }, [mine, review, today]);
  return (
    <>
      {review.length > 0 && <TaskGroup id="review" title={t('work.group.review')} rows={review} me={me} onOpen={onOpen} />}
      {groups.length === 0 && review.length === 0
        ? <EmptyState title={t('work.emptyTitle')} body={t('work.empty')} />
        : groups.map((group) => <SortableGroup key={group.group} id={group.group} title={t(`work.group.${group.group}`)} rows={group.rows} me={me} onOpen={onOpen} />)}
    </>
  );
});

const MINE_OPEN = { filter: 'mine', includeDone: false } as const;

/**
 * My open tasks: useCall('tasks.list', MINE_OPEN), with the same key and function. In the real build, while the list loads, it
 * shows the open rows of the list that Home holds, when no change marked that list. The answer then puts back the same rows
 * (performance audit 2026-10-07, FET-9). The prototype loads the list as before.
 */
function useMyOpenTasks() {
  const { api, mode } = useRuntime();
  const client = useQueryClient();
  return useQuery<TaskRow[]>({
    queryKey: ['api', 'tasks.list', MINE_OPEN],
    queryFn: () => api.call('tasks.list', MINE_OPEN),
    placeholderData: mode === 'remote' ? () => homePlaceholder(client) : undefined,
  });
}

/** My open tasks from all projects and the office, by date, with the leader's review queue first (spec 6.1). */
export function WorkTasks() {
  const [params, setParams] = useSearchParams();
  const mine = useMyOpenTasks();
  const review = useCall('tasks.list', { filter: 'review_for_me' });
  // One session.get for every group. Each row takes the person from here.
  const me = useCall('session.get', {}).data?.authority;
  // An office task has no project, so its link names the task alone (owner, 2026-10-06).
  const open = useStableHandler((row: TaskRow, thread: boolean = false) => setParams((current) => openTask(current, row.task.id, row.project?.id ?? null, thread)));
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
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className="flex flex-col gap-5">
      <WorkBody mine={mine.data} review={review.data} me={me} today={todayISO()} onOpen={open} />
      {taskId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
