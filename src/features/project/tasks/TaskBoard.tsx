import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEventHandler, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskStatus } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useToast } from '../../../app/toasts';
import { useIsPhone } from '../../../app/useIsPhone';
import { Avatar } from '../../../components/Avatar';
import { AvatarStack } from '../../../components/AvatarStack';
import { Menu } from '../../../components/Menu';
import { NoLeadMark } from '../../../components/NoLeadMark';
import { spring } from '../../../design/motion';
import { BOARD_COLUMNS, moveTargets, nextColumn } from '../../../lib/board';
import { todayISO } from '../../../lib/dates';
import { dueText, dueWord, startsLater, startsText } from '../../../lib/due';
import { versionOf } from '../../../lib/taskPeople';
import { prefersReducedMotion } from './dragSensors';
import { useStageBack } from './StageBack';
import { isWaiting, waitingNames } from '../../../lib/waiting';
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

/**
 * A card. On the Tasks screen (`across`) the board mixes projects, so the card names its project, or the word Office for a to-do of no
 * project, and a card that waits for my review says "Your review" (fbk_042).
 */
function CardFace({ row, lifted = false, across = false, yourReview = false }: { row: TaskRow; lifted?: boolean; across?: boolean; yourReview?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const word = dueWord(row.task.dueDate, todayISO(), row.task.status);
  const starts = startsLater(row.task.startDate, todayISO(), row.task.status);
  return (
    // The grip and the Move menu cover only the top end of the card, so only the title keeps 96 px free and is tall enough to
    // clear them. The box of the title follows the page direction, so a Latin title in Arabic keeps the free space on the side
    // of the buttons. The due words stay on one line, and the waiting label gets a line of its own (audit 2026-10-03, F-13).
    <div className={`surface flex flex-col gap-2 rounded-2xl p-3 ${lifted ? 'scale-[1.03] shadow-float' : ''}`}>
      <div className="min-h-8 pe-24">
        <p dir="auto" className="text-subheadline font-medium text-ink">
          {row.task.title}
          {versionOf(row.task) > 1 && <span title={t('tasks.versionLabel', { n: versionOf(row.task) })} className="tabular ms-2 rounded-full bg-fill-strong px-1.5 text-caption font-semibold text-ink-2">{t('tasks.versionBadge', { n: versionOf(row.task) })}</span>}
        </p>
      </div>
      {across && (
        <p className="flex items-center gap-2 text-footnote text-ink-2">
          {row.project ? <bdi className="truncate">{row.project.name}</bdi> : <span>{t('office.word')}</span>}
          {yourReview && <span className="ms-auto shrink-0 font-semibold text-ink">{t('workView.yourReview')}</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-ink-2">
        {starts && <span className="tabular whitespace-nowrap">{startsText(row.task.startDate as string, t, lang)}</span>}
        {!starts && word && row.task.dueDate && <span className={`tabular whitespace-nowrap ${word.tone === 'attn' ? 'font-medium text-attn' : ''}`}>{dueText(word, t, lang, row.task.dueDate)}</span>}
        {row.task.flagged && <AnimatedIcon icon={BadgeAlertIcon} size={12} className="text-attn" aria-label={t('tasks.flagged')} />}
        <span className="ms-auto">{!row.owner
          ? <NoLeadMark size={22} />
          : row.helpers.length > 0
            ? <AvatarStack leader={row.owner} team={row.helpers} max={3} size={18} leaderSize={24} />
            : <Avatar user={row.owner} size={22} />}</span>
      </div>
      {isWaiting(row) && row.task.status !== 'done' && <p dir="auto" className="text-footnote text-ink-2">{t('tasks.waitingFor', { names: waitingNames(row, lang) })}</p>}
    </div>
  );
}

function Column({ status, count, closed, note, children }: { status: TaskStatus; count: number; closed: boolean; note?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  // A closed column takes no drop, and the arrow keys skip it (audit 2026-10-03, V-5).
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: closed });
  const label = t(`taskStatus.${status}`);
  return (
    <section ref={setNodeRef} data-column={status} aria-label={t('tasks.column', { status: label, n: count })} className={`flex min-h-48 flex-col gap-2 rounded-card p-2 max-sm:snap-start ${isOver ? 'bg-fill-strong' : closed ? 'bg-fill/40' : 'bg-fill'}`}>
      <h3 className="flex items-center justify-between px-2 pt-1 text-subheadline font-semibold">
        {label}
        <span className="tabular text-footnote text-ink-2">{count}</span>
      </h3>
      {note && <p className="px-2 text-footnote text-ink-2">{note}</p>}
      {/* While a card is lifted, a column it cannot go to says so (audit 2026-10-03, F-9). */}
      {closed && <p className="px-2 text-footnote text-ink-2">{t('tasks.dropClosed')}</p>}
      {/* A phone shows one quiet line in an empty column. The column keeps its height, so it stays a drop target. */}
      {phone && !closed && count === 0 && <p className="px-2 text-footnote text-ink-2">{t('phoneWork.board.empty')}</p>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function BoardCard({ row, reviews, across, dragging, onOpen, onSendBack, onMove }: {
  row: TaskRow; reviews: boolean; across: boolean; dragging: boolean; onOpen: () => void; onSendBack: () => void; onMove: (status: TaskStatus) => void;
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
      <button type="button" onClick={onOpen} className="block w-full text-start"><CardFace row={row} across={across} yourReview={across && reviewing} /></button>
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
              ...moveTargets(row.task.status, reviewing, row.task.needsReview, row.owner !== null).map((status) => ({ label: t(`taskStatus.${status}`), onSelect: () => onMove(status) })),
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

/**
 * The four dots under the lane of a phone, one for each column (phone design D). The open dot follows the lane: an IntersectionObserver reads
 * how much of each column shows, so it works in right to left too (`scrollLeft` does not). A press scrolls the lane to the column. Each dot
 * is a button of 44 px with the name of its column, so a screen reader reaches every column without a swipe.
 */
function BoardDots({ lane, counts }: { lane: RefObject<HTMLDivElement | null>; counts: number[] }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [open, setOpen] = useState<TaskStatus>(BOARD_COLUMNS[0]!);
  useEffect(() => {
    const root = lane.current;
    if (!phone || !root || typeof IntersectionObserver === 'undefined') return undefined;
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) ratios.set((entry.target as HTMLElement).dataset.column ?? '', entry.intersectionRatio);
      let best: TaskStatus | null = null;
      let most = 0;
      for (const status of BOARD_COLUMNS) {
        const ratio = ratios.get(status) ?? 0;
        if (ratio > most) { most = ratio; best = status; }
      }
      if (best) setOpen(best);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    root.querySelectorAll('[data-column]').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [phone, lane]);
  if (!phone) return null;
  const go = (status: TaskStatus) => {
    lane.current?.querySelector(`[data-column="${status}"]`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
  };
  return (
    <div className="flex items-center justify-center">
      {BOARD_COLUMNS.map((status, at) => (
        <button
          key={status}
          type="button"
          aria-label={t('tasks.column', { status: t(`taskStatus.${status}`), n: counts[at] })}
          aria-current={open === status ? 'true' : undefined}
          onClick={() => go(status)}
          className="relative grid size-11 place-items-center rounded-full"
        >
          <span aria-hidden className="size-2 rounded-full bg-fill-strong" />
          {open === status && <motion.span aria-hidden layoutId="board-dot" transition={spring.standard} className="absolute size-2 rounded-full bg-ink" />}
        </button>
      ))}
    </div>
  );
}

/**
 * Columns To do, In progress, In review and Done. A drag, a keyboard drag or the Move menu moves a task (spec 5.3).
 * `reviews` says who may approve a task in review: one flag for a whole project (the project tab), or a function of the row, for the
 * Tasks screen, where each to-do has its own reviewers (fbk_042). `across` is for that screen: the cards name their project.
 */
export function TaskBoard({ rows, reviews, across = false, doneNote, onOpen, onSendBack }: {
  rows: TaskRow[]; reviews: boolean | ((row: TaskRow) => boolean); across?: boolean; doneNote?: string; onOpen: (taskId: string) => void; onSendBack: (taskId: string) => void;
}) {
  const reviewsOf = (row: TaskRow) => (typeof reviews === 'function' ? reviews(row) : reviews);
  const { t } = useTranslation();
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const droppedAt = useRef(0);
  const board = useRef<HTMLDivElement>(null);
  const back = useStageBack();
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
    onRefused: (error, input) => back.refused(error, input, (next) => move.mutate(next)),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeys }),
  );
  const closedFor = (row: TaskRow, status: TaskStatus) => status !== row.task.status && !moveTargets(row.task.status, reviewsOf(row), row.task.needsReview, row.owner !== null).includes(status);
  // The screen point of the pointer while a card is lifted. The delta of the drag end also counts the scroll of the board
  // and the page since the drag began, so on a phone, where the board scrolls, it missed the column (audit 2026-10-03, F-9).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!activeId) return undefined;
    pointer.current = null;
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointermove', track, true);
    window.addEventListener('pointerup', track, true);
    return () => {
      window.removeEventListener('pointermove', track, true);
      window.removeEventListener('pointerup', track, true);
    };
  }, [activeId]);
  const onDragEnd = ({ active, over, activatorEvent }: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    const row = rows.find((r) => r.task.id === active.id);
    if (!row) return;
    if (over && moveTargets(row.task.status, reviewsOf(row), row.task.needsReview, row.owner !== null).includes(over.id as TaskStatus)) {
      move.mutate({ id: row.task.id, status: over.id as TaskStatus });
      return;
    }
    // A closed column takes no drop, so the card went back with no visible reason. When the pointer let go over a closed
    // column, a toast says why and opens the review block (audit 2026-10-03, F-9). Only a card in review or a card with no lead has closed columns.
    // A keyboard drag has no pointer point and cannot reach a closed column.
    const at = pointer.current;
    if (!at || typeof (activatorEvent as Partial<PointerEvent>).clientX !== 'number') return;
    const { x, y } = at;
    const refused = BOARD_COLUMNS.some((status) => {
      const box = closedFor(row, status) ? board.current?.querySelector(`[data-column="${status}"]`)?.getBoundingClientRect() : undefined;
      return box !== undefined && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom; // rtl-ok: screen coordinates
    });
    if (refused) {
      // The reviewer is told to send back with a note; the lead, whose task waits for review, is told who finishes it (F-19).
      // A task with no lead is told that it needs a lead first, with the way to its panel (owner, 2026-10-05).
      toast.show(row.owner === null
        ? { message: t('lead.needsLeadToast'), action: { label: t('tasks.openTask'), run: () => onOpen(row.task.id), isUndo: false } }
        : reviewsOf(row)
          ? { message: t('errors.reasons.review_send_back'), action: { label: t('tasks.openTask'), run: () => onOpen(row.task.id), isUndo: false } }
          : { message: t('tasks.waitsForApproval') });
    }
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
      <div
        ref={board}
        className="-mx-4 grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-2 max-sm:auto-cols-[calc(100%-3rem)] max-sm:snap-x max-sm:snap-mandatory max-sm:overscroll-x-contain max-sm:scroll-ps-4 sm:mx-0 sm:px-0"
      >
        {BOARD_COLUMNS.map((status) => {
          const columnRows = rows.filter((row) => row.task.status === status);
          return (
            <Column key={status} status={status} count={columnRows.length} closed={!!lifted && closedFor(lifted, status)} note={status === 'done' ? doneNote : undefined}>
              {columnRows.map((row) => (
                <BoardCard
                  key={row.task.id}
                  row={row}
                  reviews={reviewsOf(row)}
                  across={across}
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
      <BoardDots lane={board} counts={BOARD_COLUMNS.map((status) => rows.filter((row) => row.task.status === status).length)} />
      <DragOverlay dropAnimation={{ duration: 350, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' }}>
        {lifted ? <CardFace row={lifted} lifted across={across} yourReview={across && reviewsOf(lifted) && lifted.task.status === 'in_review'} /> : null}
      </DragOverlay>
      {back.sheet}
    </DndContext>
  );
}
