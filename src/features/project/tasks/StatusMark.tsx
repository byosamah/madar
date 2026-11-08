import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskStatus } from '../../../api/contract/entities';

/** One shape for each status, so the color never carries the meaning alone (the shape signs of DESIGN.md). Ring, half ring, ring with a dot, ring with a tick. */
const SHAPE: Record<TaskStatus, ReactNode> = {
  todo: <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  in_progress: <><circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 1.5A4 4 0 0 0 5.5 9.5Z" fill="currentColor" /></>,
  in_review: <><circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="5.5" cy="5.5" r="1.4" fill="currentColor" /></>,
  done: <><circle cx="5.5" cy="5.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m3.3 5.6 1.5 1.5 2.9-2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>,
};

/**
 * The status of a to-do as a small shape sign and an ink word, with no tinted pill (the card of the stage board of a continuous project,
 * fbk_085). The sign is grey and the word is ink, so a status never looks like Late or At risk.
 */
export function StatusMark({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return (
    <span data-task-status={status} className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption font-semibold text-ink">
      <svg viewBox="0 0 11 11" aria-hidden="true" className="size-[11px] shrink-0 text-ink-2">{SHAPE[status]}</svg>
      {t(`taskStatus.${status}`)}
    </span>
  );
}
