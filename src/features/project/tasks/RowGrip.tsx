import type { ButtonHTMLAttributes, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';
import { useTouchPhone } from './useTouchPhone';

/**
 * The end of a sortable row. Only a person who may change the task gets the grip; the other rows keep a blank of its size. A list with
 * one task, or with no task of the person, shows no grip at all. The static list draws the grip with no handle (no listeners). The drag
 * layer (`DragLayer.tsx`, a chunk of its own, performance audit 2026-10-21, FL-2) gives the handle: the activator ref, and the
 * attributes and listeners of dnd-kit. The markup is the same, so the swap changes no look.
 * On a touch phone the grip is `sr-only` (phone design D): a finger lifts the whole row with a press and hold (`DragLayer.tsx`), and the
 * grip stays in the page for the keyboard and a screen reader. A row that cannot move has no blank there, so the row gains the room.
 */
export function RowGrip({ row, sortable, activatorRef, handle }: {
  row: TaskRow; sortable: boolean; activatorRef?: Ref<HTMLButtonElement>; handle?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const touch = useTouchPhone();
  if (!sortable) return null;
  if (!row.canMove) return touch ? null : <span aria-hidden className="w-8 shrink-0" />;
  return (
    <button
      ref={activatorRef}
      type="button"
      {...handle}
      aria-label={t('work.arrange.grip', { title: row.task.title })}
      className={touch ? 'sr-only' : 'grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-label-3 hover:bg-fill active:cursor-grabbing'}
    >
      <AnimatedIcon icon={GripVerticalIcon} size={16} aria-hidden />
    </button>
  );
}
