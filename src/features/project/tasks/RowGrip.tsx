import type { ButtonHTMLAttributes, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';

/**
 * The end of a sortable row. Only a person who may change the task gets the grip; the other rows keep a blank of its size. A list with
 * one task, or with no task of the person, shows no grip at all. The static list draws the grip with no handle (no listeners). The drag
 * layer (`DragLayer.tsx`, a chunk of its own, performance audit 2026-10-21, FL-2) gives the handle: the activator ref, and the
 * attributes and listeners of dnd-kit. The markup is the same, so the swap changes no look.
 */
export function RowGrip({ row, sortable, activatorRef, handle }: {
  row: TaskRow; sortable: boolean; activatorRef?: Ref<HTMLButtonElement>; handle?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  if (!sortable) return null;
  if (!row.canMove) return <span aria-hidden className="w-8 shrink-0" />;
  return (
    <button
      ref={activatorRef}
      type="button"
      {...handle}
      aria-label={t('work.arrange.grip', { title: row.task.title })}
      className="grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-label-3 hover:bg-fill active:cursor-grabbing"
    >
      <AnimatedIcon icon={GripVerticalIcon} size={16} aria-hidden />
    </button>
  );
}
