import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MinutesView } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { formatDay, stampDay } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { FileChips } from '../files/Attachments';

/**
 * The look of a quiet control of the minutes: a text link in the link colour, as "Open the team meeting view" of the meeting sheet. It is never
 * a main button, so a sheet keeps its one next step. It has no side padding, so its text lines up with the facts above it.
 */
export const QUIET = 'pressable inline-flex min-h-11 items-center text-subheadline font-semibold text-link hover:underline';

/**
 * The read part of the minutes of a meeting (wave 2, owner 2026-10-19), for the meeting sheet and the Tracker entry sheet: the text with its
 * line breaks, the files, who wrote it and the day, and one quiet "Edit the minutes" for the people who may. The link to the other place
 * (the Tracker line, or the meeting) goes in as a child. Every control is quiet: the minutes are no main step of a sheet.
 */
export function MinutesBody({ minutes, canEdit, onEdit, className = '', children }: { minutes: MinutesView; canEdit: boolean; onEdit: () => void; className?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {minutes.text && <p dir="auto" className="whitespace-pre-wrap break-words text-ink">{minutes.text}</p>}
      <FileChips files={minutes.files} />
      <p className="text-footnote text-ink-2">
        {t('minutes.by', { name: nameOf(minutes.updatedBy), day: formatDay(stampDay(minutes.updatedAt), lang), context: actorContext(minutes.updatedBy) })}
      </p>
      {(canEdit || children) && (
        <div className="flex flex-wrap items-center gap-x-5">
          {canEdit && <button type="button" className={QUIET} onClick={onEdit}>{t('minutes.edit')}</button>}
          {children}
        </div>
      )}
    </div>
  );
}

/** The one quiet button of a meeting that ended and has no minutes yet. It is no main button, and it comes with no task and no notice. */
export function AddMinutes({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return <button type="button" className={`${QUIET} self-start`} onClick={onClick}>{t('minutes.add')}</button>;
}
