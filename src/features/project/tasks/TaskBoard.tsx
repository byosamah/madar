import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';
import { useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskStatus } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { AvatarStack } from '../../../components/AvatarStack';
import { Menu } from '../../../components/Menu';
import { BOARD_COLUMNS, moveTargets, nextColumn } from '../../../lib/board';
import { todayISO } from '../../../lib/dates';
import { dueText, dueWord, startsLater, startsText } from '../../../lib/due';
import { versionOf } from '../../../lib/taskPeople';
import { useStageBack } from './StageBack';
import { isWaiting, waitingNames } from './waiting';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';

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
  const { t } = useTranslation();
  const lang = useLang();
  const word = dueWord(row.task.dueDate, todayISO(), row.task.status);
  const starts = startsLater(row.task.startDate, todayISO(), row.task.status);
  return (
    <div className={`surface flex flex-col gap-2 rounded-2xl p-3 pe-24 ${lifted ? 'scale-[1.03] shadow-float' : ''}`}>
      <p dir="auto" className="text-subheadline font-medium text-ink">
        {row.task.title}
        {versionOf(row.task) > 1 && <span title={t('tasks.versionLabel', { n: versionOf(row.task) })} className="tabular ms-2 rounded-full bg-fill-strong px-1.5 text-caption font-semibold text-ink-2">{t('tasks.versionBadge', { n: versionOf(row.task) })}</span>}
      </p>
      <div className="flex items-center gap-2 text-footnote text-ink-2">
        {starts && <span className="tabular">{startsText(row.task.startDate as string, t, lang)}</span>}
        {!starts && word && row.task.dueDate && <span className={`tabular ${word.tone === 'attn' ? 'font-medium text-attn' : ''}`}>{dueText(word, t, lang, row.task.dueDate)}</span>}
        {row.task.flagged && <AnimatedIcon icon={BadgeAlertIcon} size={12} className="text-attn" aria-label={t('tasks.flagged')} />}
        {isWaiting(row) && row.task.status !== 'done' && <span dir="auto" className="min-w-0 truncate">{t('tasks.waitingFor', { names: waitingNames(row, lang) })}</span>}
        <span className="ms-auto">{row.helpers.length > 0
          ? <AvatarStack leader={row.owner} team={row.helpers} max={3} size={18} leaderSize={24} />
          : <Avatar user={row.owner} size={22} />}</span>
      </div>
    </div>
  );
}

function Column({ status, count, closed, children }: { status: TaskStatus; count: number; closed: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  // A closed column takes no drop, and the arrow keys skip it (audit 2026-10-03, V-5).
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: closed });
  const label = t(`taskStatus.${status}`);
  return (
    <section ref={setNodeRef} aria-label={t('tasks.column', { status: label, n: count })} className={`flex min-h-48 flex-col gap-2 rounded-card p-2 ${isOver ? 'bg-fill-strong' : 'bg-fill'}`}>
      <h3 className="flex items-center justify-between px-2 pt-1 text-subheadline font-semibold">
        {label}
        <span className="tabular text-footnote text-ink-2">{count}</span>
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function BoardCard({ row, reviews, dragging, onOpen, onSendBack, onMove }: {
  row: TaskRow; reviews: boolean; dragging: boolean; onOpen: () => void; onSendBack: () => void; onMove: (status: TaskStatus) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: row.task.id, data: { status: row.task.status }, disabled: !row.canMove,
  });
  // The whole card follows a pointer drag. Only the grip starts a keyboard drag, so Enter on the title opens the task.
  const pointerOnly = listeners?.onPointerDown ? { onPointerDown: listeners.onPointerDown as PointerEventHandler<HTMLLIElement> } : {};
  const reviewing = reviews && row.task.status === 'in_review';
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
            <AnimatedIcon icon={GripVerticalIcon} size={16} aria-hidden />
          </button>
          <Menu
            label={t('tasks.moveTo', { title: row.task.title })}
            items={[
              ...moveTargets(row.task.status, reviewing, row.task.needsReview).map((status) => ({ label: t(`taskStatus.${status}`), onSelect: () => onMove(status) })),
              // Send back needs a note, so the item opens the task panel, where the review block comes first (audit 2026-10-03, V-5).
              // The panel opens ready for the note (audit 2026-10-03, F-8).
              { label: t('tasks.sendBackOpen'), onSelect: onSendBack, hidden: !reviewing },
            ]}
          />
        </div>
      )}
    </li>
  );
}

/** Columns To do, In progress, In review and Done. A drag, a keyboard drag or the Move menu moves a task (spec 5.3). */
export function TaskBoard({ rows, reviews, canLog, onOpen, onSendBack }: {
  rows: TaskRow[]; reviews: boolean; canLog: boolean; onOpen: (taskId: string) => void; onSendBack: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const droppedAt = useRef(0);
  const back = useStageBack(canLog);
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
    onRefused: (error, input) => back.refused(error, input, (next) => move.mutate(next)),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeys }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    const row = rows.find((r) => r.task.id === active.id);
    if (row && over && moveTargets(row.task.status, reviews, row.task.needsReview).includes(over.id as TaskStatus)) move.mutate({ id: row.task.id, status: over.id as TaskStatus });
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
            <Column key={status} status={status} count={columnRows.length} closed={!!lifted && status !== lifted.task.status && !moveTargets(lifted.task.status, reviews, lifted.task.needsReview).includes(status)}>
              {columnRows.map((row) => (
                <BoardCard
                  key={row.task.id}
                  row={row}
                  reviews={reviews}
                  dragging={row.task.id === activeId}
                  onOpen={() => open(row.task.id)}
                  onSendBack={() => onSendBack(row.task.id)}
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
      {back.sheet}
    </DndContext>
  );
}
