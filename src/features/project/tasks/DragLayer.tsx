import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { RowGrip } from './RowGrip';
import { TaskRowItem } from './TaskRowItem';

/**
 * The drag part of the sortable task list (performance audit 2026-10-21, FL-2). It holds everything of dnd-kit, so it is a chunk of
 * its own: the first load draws the list with `StaticRows` (`SortableTaskRows.tsx`), and this layer takes its place once it has loaded.
 */
type Open = (row: TaskRow, thread?: boolean) => void;

// The options of the sensors are the same objects at each render (RN-5): a new object gave dnd-kit new sensors, and every row rendered again.
const POINTER_OPTIONS = { activationConstraint: { distance: 4 } };
const KEYBOARD_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

/** One row of the sortable list. The row renders again only when its own data changes or dnd-kit says so (a drag). */
const SortableRow = memo(function SortableRow({ row, me, onOpen, still, sortable, showProject, today }: {
  row: TaskRow; me: User | undefined; onOpen: Open; still: boolean; sortable: boolean; showProject: boolean; today: string;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    // A task the person only helps with sits at the end of the group and takes no drop (`groupMyTasks`).
    id: row.task.id, disabled: !sortable || !row.canMove,
  });
  // The row moves up and down only.
  const style = { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition };
  const grip = <RowGrip row={row} sortable={sortable} activatorRef={setActivatorNodeRef} handle={{ ...attributes, ...listeners }} />;
  return (
    <TaskRowItem
      row={row}
      me={me}
      onOpen={onOpen}
      showProject={showProject}
      today={today}
      drag={{ ref: setNodeRef, style, lifted: isDragging, still, grip }}
    />
  );
});

export type DragRowsProps = {
  rows: TaskRow[]; me: User | undefined; onOpen: Open; showProject: boolean; sortable: boolean; today: string; listClassName?: string; listRef: Ref<HTMLUListElement>;
};

/**
 * The rows of one list that a person drags into a new order (owner, 2026-10-07). The order belongs to the tasks, so everyone who
 * sees them sees it. A drag never leaves the list and never changes a date: the Tasks screen and Home use one date group, the
 * project task list uses one stage. The new order shows at once and stays until the answer of the server comes back with the new
 * places.
 */
export function DragRows({ rows, me, onOpen, showProject, sortable, today, listClassName, listRef }: DragRowsProps) {
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
  // The ids are one array for as long as the places stay the same (RN-5), so the sortable context does not change at each render.
  const idsKey = shown.map((row) => row.task.id).join(',');
  const ids = useMemo(() => (idsKey === '' ? [] : idsKey.split(',')), [idsKey]);
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_OPTIONS),
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
        <ul ref={listRef} className={listClassName}>
          <AnimatePresence initial={false}>
            {shown.map((row) => <SortableRow key={row.task.id} row={row} me={me} onOpen={onOpen} still={still} sortable={sortable} showProject={showProject} today={today} />)}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  );
}
