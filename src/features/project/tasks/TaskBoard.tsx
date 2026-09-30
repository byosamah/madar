import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import { Flag, GripVertical } from 'lucide-react';
import { useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskStatus } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { Menu } from '../../../components/Menu';
import { BOARD_COLUMNS, nextColumn } from '../../../lib/board';
import { formatDay } from '../../../lib/dates';

/** Arrow keys move a lifted card to the next column. The end-side arrow moves forward (spec 10.9). */
const columnKeys: KeyboardCoordinateGetter = (event, { context }) => {
  const current = (context.over?.id ?? context.active?.data.current?.status) as TaskStatus | undefined;
  if (!current) return undefined;
  const target = nextColumn(current, event.code, document.documentElement.dir === 'rtl');
  const rect = target ? context.droppableRects.get(target) : undefined;
  if (!rect) return undefined;
  event.preventDefault();
  const width = context.collisionRect?.width ?? 0;
  return { x: rect.left + rect.width / 2 - width / 2, y: rect.top + 56 }; // rtl-ok: screen coordinates
};

function CardFace({ row, lifted = false }: { row: TaskRow; lifted?: boolean }) {
  const lang = useLang();
  return (
    <div className={`surface flex flex-col gap-2 rounded-2xl p-3 pe-24 ${lifted ? 'scale-[1.03] shadow-float' : ''}`}>
      <p dir="auto" className="text-subheadline font-medium">{row.task.title}</p>
      <div className="flex items-center gap-2 text-footnote text-label-2">
        {row.task.dueDate && <span className={`tabular ${row.overdue ? 'font-medium text-red-text' : ''}`}>{formatDay(row.task.dueDate, lang)}</span>}
        {row.task.flagged && <Flag size={12} className="text-orange-text" aria-hidden />}
        <span className="ms-auto"><Avatar user={row.owner} size={22} /></span>
      </div>
    </div>
  );
}

function Column({ status, count, children }: { status: TaskStatus; count: number; children: ReactNode }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = t(`taskStatus.${status}`);
  return (
    <section ref={setNodeRef} aria-label={t('tasks.column', { status: label, n: count })} className={`flex min-h-48 flex-col gap-2 rounded-card p-2 ${isOver ? 'bg-fill-strong' : 'bg-fill'}`}>
      <h3 className="flex items-center justify-between px-2 pt-1 text-subheadline font-semibold">
        {label}
        <span className="tabular text-footnote text-label-2">{count}</span>
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function BoardCard({ row, dragging, onOpen, onMove }: { row: TaskRow; dragging: boolean; onOpen: () => void; onMove: (status: TaskStatus) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: row.task.id, data: { status: row.task.status }, disabled: !row.canMove,
  });
  // The whole card follows a pointer drag. Only the grip starts a keyboard drag, so Enter on the title opens the task.
  const pointerOnly = listeners?.onPointerDown ? { onPointerDown: listeners.onPointerDown as PointerEventHandler<HTMLLIElement> } : {};
  return (
    <li ref={setNodeRef} {...pointerOnly} className={`relative ${dragging ? 'opacity-40' : ''}`}>
      <button type="button" onClick={onOpen} className="block w-full text-start"><CardFace row={row} /></button>
      {row.canMove && (
        <div className="absolute end-1 top-1 flex" onPointerDown={(event) => event.stopPropagation()}>
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t('tasks.drag', { title: row.task.title })}
            className="grid size-11 cursor-grab place-items-center rounded-full text-label-3 hover:bg-fill"
          >
            <GripVertical size={16} aria-hidden />
          </button>
          <Menu
            label={t('tasks.moveTo', { title: row.task.title })}
            items={BOARD_COLUMNS.filter((status) => status !== row.task.status).map((status) => ({ label: t(`taskStatus.${status}`), onSelect: () => onMove(status) }))}
          />
        </div>
      )}
    </li>
  );
}

/** Columns To do, In progress, In review and Done. A drag, a keyboard drag or the Move menu moves a task (spec 5.3). */
export function TaskBoard({ rows, onOpen }: { rows: TaskRow[]; onOpen: (taskId: string) => void }) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const droppedAt = useRef(0);
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeys }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    const row = rows.find((r) => r.task.id === active.id);
    if (row && over && over.id !== row.task.status) move.mutate({ id: row.task.id, status: over.id as TaskStatus });
  };
  // The click that ends a pointer drag must not open the task.
  const open = (taskId: string) => {
    if (Date.now() - droppedAt.current > 250) onOpen(taskId);
  };
  const lifted = rows.find((row) => row.task.id === activeId);
  // Screen readers hear task titles and column names in the interface language, never raw IDs.
  const titleOf = (id: UniqueIdentifier) => rows.find((row) => row.task.id === id)?.task.title ?? '';
  const statusOf = (id: UniqueIdentifier) => t(`taskStatus.${String(id)}`);
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('tasks.dnd.pickedUp', { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => (over ? t('tasks.dnd.over', { title: titleOf(active.id), status: statusOf(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t('tasks.dnd.dropped', { title: titleOf(active.id), status: statusOf(over.id) })
      : t('tasks.dnd.cancelled', { title: titleOf(active.id) })),
    onDragCancel: ({ active }) => t('tasks.dnd.cancelled', { title: titleOf(active.id) }),
  };
  return (
    <DndContext
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('tasks.dnd.instructions') } }}
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="-mx-4 grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {BOARD_COLUMNS.map((status) => {
          const columnRows = rows.filter((row) => row.task.status === status);
          return (
            <Column key={status} status={status} count={columnRows.length}>
              {columnRows.map((row) => (
                <BoardCard
                  key={row.task.id}
                  row={row}
                  dragging={row.task.id === activeId}
                  onOpen={() => open(row.task.id)}
                  onMove={(to) => move.mutate({ id: row.task.id, status: to })}
                />
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 350, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' }}>
        {lifted ? <CardFace row={lifted} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}
