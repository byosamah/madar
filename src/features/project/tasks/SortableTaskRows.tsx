import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';
import { TaskRowItem } from './TaskRowItem';

type Open = (row: TaskRow, thread?: boolean) => void;

/**
 * One row of a sortable list. Only a person who may change the task gets the grip; the other rows keep a blank of its size.
 * A list with one task, or with no task of the person, shows no grip at all.
 */
function SortableRow({ row, me, onOpen, still, sortable, showProject }: {
  row: TaskRow; me: User | undefined; onOpen: Open; still: boolean; sortable: boolean; showProject: boolean;
}) {
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
      showProject={showProject}
      drag={{ ref: setNodeRef, style, lifted: isDragging, still, grip }}
    />
  );
}

/**
 * The rows of one list that a person drags into a new order (owner, 2026-10-07). The order belongs to the tasks, so everyone who
 * sees them sees it. A drag never leaves the list and never changes a date: the Tasks screen and Home use one date group, the
 * project task list uses one stage. The new order shows at once and stays until the answer of the server comes back with the new
 * places. With one task, with no task of the person, or with `draggable` off, it shows no grip.
 */
export function SortableTaskRows({ rows, me, onOpen, showProject = false, draggable = true, listClassName }: {
  rows: TaskRow[]; me: User | undefined; onOpen: Open; showProject?: boolean; draggable?: boolean; listClassName?: string;
}) {
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
  const sortable = draggable && rows.length > 1 && rows.some((row) => row.canMove);
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
  // Screen readers hear the task title and its place in the list, in the screen language.
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
    <DndContext
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('work.arrange.instructions') } }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={start}
      onDragEnd={onDragEnd}
      onDragCancel={stop}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={listClassName}>
          <AnimatePresence initial={false}>
            {shown.map((row) => <SortableRow key={row.task.id} row={row} me={me} onOpen={onOpen} still={still} sortable={sortable} showProject={showProject} />)}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  );
}
