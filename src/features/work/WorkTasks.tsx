import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { User } from '../../api/contract/entities';
import type { TaskRow } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../components/icons/animated/grip-vertical';
import { todayISO } from '../../lib/dates';
import { groupMyTasks } from '../../lib/myWork';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { LoadFailed } from '../../components/LoadFailed';
import { openTask } from '../../lib/params';

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
 * One row of a sortable group. Only a person who may change the task gets the grip; the other rows keep a blank of its size.
 * A group with one task, or with no task of the person, shows no grip at all.
 */
function SortableRow({ row, me, onOpen, still, sortable }: { row: TaskRow; me: User | undefined; onOpen: Open; still: boolean; sortable: boolean }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    // A task the person only helps with sits at the end of the group and takes no drop (`groupMyTasks`).
    id: row.task.id, disabled: !sortable || !row.canMove,
  });
  // The row moves up and down only.
  const style = { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition };
  const grip = !sortable ? null : row.canMove ? (
    <button
      ref={setActivatorNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={t('work.arrange.grip', { title: row.task.title })}
      className="grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-label-3 hover:bg-fill active:cursor-grabbing"
    >
      <AnimatedIcon icon={GripVerticalIcon} size={16} aria-hidden />
    </button>
  ) : <span aria-hidden className="w-8 shrink-0" />;
  return (
    <TaskRowItem
      row={row}
      me={me}
      onOpen={(_, thread) => onOpen(row, thread)}
      showProject
      drag={{ ref: setNodeRef, style, lifted: isDragging, still, grip }}
    />
  );
}

/**
 * A date group whose tasks a person drags into a new order (owner, 2026-10-07). The order belongs to the tasks, so everyone
 * who sees them sees it. A drag never leaves the group and never changes a date. The new order shows at once and stays until
 * the answer of the server comes back with the new places. With one task, or with no task of the person, it shows no grip.
 */
function SortableGroup({ id, title, rows, me, onOpen }: { id: string; title: string; rows: TaskRow[]; me: User | undefined; onOpen: Open }) {
  const { t } = useTranslation();
  const arrange = useUndoable('tasks.arrange', { message: () => t('work.arrange.saved') });
  const [order, setOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const [still, setStill] = useState(false);
  const settle = useRef(0);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  const key = rows.map((row) => `${row.task.id}:${row.task.rank ?? ''}`).join(',');
  const byId = new Map(rows.map((row) => [row.task.id, row]));
  const shown = order?.key === key ? order.ids.flatMap((taskId) => byId.get(taskId) ?? []) : rows;
  // The local order ends when the rows change. An Undo brings the old places back, and it must not bring this order back too.
  useEffect(() => {
    if (order && order.key !== key) setOrder(null);
  }, [key, order]);
  const ids = shown.map((row) => row.task.id);
  const sortable = rows.length > 1 && rows.some((row) => row.canMove);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const start = () => {
    window.clearTimeout(settle.current);
    setStill(true);
  };
  // The slide of the rows comes back after the drop has settled.
  const stop = () => {
    settle.current = window.setTimeout(() => setStill(false), 400);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    stop();
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder({ key, ids: next });
    const movable = next.filter((taskId) => byId.get(taskId)?.canMove);
    arrange.mutate({ ids: movable, moved: String(active.id) }, { onError: () => setOrder(null) });
  };
  // Screen readers hear the task title and its place in the group, in the screen language.
  const titleOf = (taskId: UniqueIdentifier) => byId.get(String(taskId))?.task.title ?? '';
  const place = (taskId: UniqueIdentifier) => ({ n: ids.indexOf(String(taskId)) + 1, count: ids.length });
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('work.arrange.pickedUp', { title: titleOf(active.id), ...place(active.id) }),
    onDragOver: ({ active, over }) => (over ? t('work.arrange.over', { title: titleOf(active.id), ...place(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t('work.arrange.dropped', { title: titleOf(active.id), ...place(over.id) })
      : t('tasks.dnd.cancelled', { title: titleOf(active.id) })),
    onDragCancel: ({ active }) => t('tasks.dnd.cancelled', { title: titleOf(active.id) }),
  };
  return (
    <section aria-labelledby={`work-${id}`} className="surface rounded-card pb-2">
      <h2 id={`work-${id}`} className="px-4 pb-1 pt-3 text-headline">{title}</h2>
      <DndContext
        accessibility={{ announcements, screenReaderInstructions: { draggable: t('work.arrange.instructions') } }}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={start}
        onDragEnd={onDragEnd}
        onDragCancel={stop}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul>
            <AnimatePresence initial={false}>
              {shown.map((row) => <SortableRow key={row.task.id} row={row} me={me} onOpen={onOpen} still={still} sortable={sortable} />)}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>
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
        : groups.map((group) => <SortableGroup key={group.group} id={group.group} title={t(`work.group.${group.group}`)} rows={group.rows} me={me} onOpen={open} />)}
      {taskId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
