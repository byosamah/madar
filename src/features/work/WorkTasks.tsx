import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { User } from '../../api/contract/entities';
import type { TaskRow } from '../../api/contract/views';
import { useCall, useRuntime } from '../../app/runtime';
import { useIsPhone } from '../../app/useIsPhone';
import { useStableHandler } from '../../app/useStableHandler';
import { EmptyState } from '../../components/EmptyState';
import { fade } from '../../design/motion';
import { todayISO } from '../../lib/dates';
import { groupMyTasks } from '../../lib/myWork';
import { loadDragLayer, loadedDragLayer } from '../project/tasks/dragLayerLoader';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { SortableTaskRows } from '../project/tasks/SortableTaskRows';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { useTouchPhone } from '../project/tasks/useTouchPhone';
import { LoadFailed } from '../../components/LoadFailed';
import { openTask } from '../../lib/params';
import { doneWindow } from './boardRows';
import { homePlaceholder } from './minePlaceholder';
import { lazyWorkBoard } from './WorkBoardLazy';
import { MINE_OPEN, REVIEW_FOR_ME } from './readInputs';
import type { WorkView } from './workView';

type Open = (row: TaskRow, thread?: boolean) => void;

function TaskGroup({ id, title, rows, me, today, onOpen }: { id: string; title: string; rows: TaskRow[]; me: User | undefined; today: string; onOpen: Open }) {
  return (
    <section aria-labelledby={`work-${id}`} className="surface overflow-hidden rounded-card pb-2">
      <h2 id={`work-${id}`} className="px-4 pb-1 pt-3 text-headline">{title}</h2>
      <ul>
        <AnimatePresence initial={false}>
          {rows.map((row) => <TaskRowItem key={row.task.id} row={row} me={me} onOpen={onOpen} today={today} showProject />)}
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
 * The one quiet line under the last group of a touch phone: a press and hold changes the order (phone design D). It shows only when a
 * group has two rows or more that the person may move, and only after the drag layer has loaded, because a hold before that does
 * nothing. It has its own state, so the layer becoming ready renders the hint alone and no row.
 */
function HoldHint({ sortable }: { sortable: boolean }) {
  const { t } = useTranslation();
  const touch = useTouchPhone();
  const [ready, setReady] = useState(() => loadedDragLayer() !== null);
  useEffect(() => {
    if (ready || !touch || !sortable) return undefined;
    let live = true;
    loadDragLayer().then(() => { if (live) setReady(true); }, () => undefined);
    return () => {
      live = false;
    };
  }, [ready, touch, sortable]);
  if (!touch || !sortable || !ready) return null;
  return <p className="text-footnote text-label-2">{t('phoneWork.holdHint')}</p>;
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
  // The rule of `SortableTaskRows`: a group with two rows or more, one of them mine to move. The review group has no drag.
  const sortable = groups.some((group) => group.rows.length > 1 && group.rows.some((row) => row.canMove));
  return (
    <>
      {review.length > 0 && <TaskGroup id="review" title={t('work.group.review')} rows={review} me={me} today={today} onOpen={onOpen} />}
      {groups.length === 0 && review.length === 0
        ? <EmptyState title={t('work.emptyTitle')} body={t('work.empty')} />
        : groups.map((group) => <SortableGroup key={group.group} id={group.group} title={t(`work.group.${group.group}`)} rows={group.rows} me={me} onOpen={onOpen} />)}
      <HoldHint sortable={sortable} />
    </>
  );
});

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

/**
 * My open tasks from all projects and the office, by date, with the leader's review queue first (spec 6.1). The Board view shows the
 * same rows in the four columns of the project board, with the to-dos that I finished in the last 7 days in Done (fbk_042). The
 * done rows are read only while the Board shows.
 */
export function WorkTasks({ view = 'list' }: { view?: WorkView }) {
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const mine = useMyOpenTasks();
  const review = useCall('tasks.list', REVIEW_FOR_ME);
  const board = view === 'board';
  const today = todayISO();
  const donePlan = useMemo(() => doneWindow(today), [today]);
  const done = useCall('tasks.list', donePlan, { enabled: board });
  // "Send back with a note" on a card opens the panel ready for the note. The choice lives here for that one opening, not in the
  // link, so Back, a reload or another task opens the plain panel (the same rule as the project board).
  const [sendBackId, setSendBackId] = useState<string | null>(null);
  const taskParam = params.get('task');
  useEffect(() => {
    if (taskParam !== sendBackId) setSendBackId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam]);
  // One session.get for every group. Each row takes the person from here.
  const me = useCall('session.get', {}).data?.authority;
  // An office task has no project, so its link names the task alone (owner, 2026-10-06).
  const open = useStableHandler((row: TaskRow, thread: boolean = false) => setParams((current) => openTask(current, row.task.id, row.project?.id ?? null, thread)));
  const sendBack = useStableHandler((row: TaskRow) => {
    setSendBackId(row.task.id);
    open(row);
  });
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    next.delete('thread');
    return next;
  }), [setParams]);
  const failed = mine.error ?? review.error ?? (board ? done.error : null);
  if (failed) {
    return <LoadFailed error={failed} onRetry={() => { void mine.refetch(); void review.refetch(); if (board) void done.refetch(); }} />;
  }
  if (!mine.data || !review.data || (board && !done.data)) return null;
  const taskId = params.get('task');
  const projectId = params.get('project');
  const Board = lazyWorkBoard.Overlay;
  const content = board && done.data
    ? <Board mine={mine.data} review={review.data} done={done.data} onOpen={open} onSendBack={sendBack} />
    : <WorkBody mine={mine.data} review={review.data} me={me} today={today} onOpen={open} />;
  return (
    <div className="flex flex-col gap-5">
      {/* On a phone the swap between List and Board fades in (150 ms, reduced motion makes it instant). A desk keeps its DOM. */}
      {phone
        ? <motion.div key={view} className="flex flex-col gap-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>{content}</motion.div>
        : content}
      {taskId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} noteFirst={sendBackId === taskId} />}
    </div>
  );
}
