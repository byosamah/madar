import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSchedule } from '../../../api/contract/entities';
import { useLang } from '../../../app/lang';
import { DateDraftField, TextField } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { formatDay } from '../../../lib/dates';
import { counted } from '../../../lib/grammar';
import { dueFromDuration } from '../../../lib/workdays';

export type Timing = { startDate: string | null; schedule: TaskSchedule; durationDays: number | null; dueDate: string | null };

/** A first guess for a task that turns dynamic: one working week. */
const STARTING_DURATION = 5;

/** A whole number of working days, saved when the person leaves the field or presses Enter. */
function DurationField({ id, label, value, onCommit }: { id: string; label: string; value: number | null; onCommit: (days: number) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const days = Number(draft);
    if (draft === String(value)) return;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    onCommit(days);
  };
  return (
    <TextField
      id={id}
      label={label}
      type="number"
      inputMode="numeric"
      min={1}
      max={365}
      step={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/**
 * The start date, the two ways to time a task, and the field each way needs (owner's request, 2026-10-01).
 * Static: a start and a due date. Dynamic: a start and working days, and the due date follows.
 * Every change goes up as a small patch; the server holds the rules.
 */
export function TaskTiming({ idPrefix, value, onPatch }: { idPrefix: string; value: Timing; onPatch: (changes: Partial<Timing>) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const dynamic = value.schedule === 'dynamic';
  // The saved due date is the server's answer. A form that is not saved yet counts it here, for the words only.
  const due = value.dueDate ?? (value.startDate && value.durationDays ? dueFromDuration(value.startDate, value.durationDays) : null);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <DateDraftField id={`${idPrefix}-start`} label={t('taskSheet.startDate')} value={value.startDate ?? ''} onCommit={(startDate) => onPatch({ startDate })} />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="field-label">{t('taskSheet.scheduleMode')}</span>
        <SegmentedControl<TaskSchedule>
          label={t('taskSheet.scheduleMode')}
          value={value.schedule}
          options={[{ value: 'static', label: t('taskSheet.scheduleStatic') }, { value: 'dynamic', label: t('taskSheet.scheduleDynamic') }]}
          onChange={(schedule) => {
            if (schedule === value.schedule) return;
            onPatch(schedule === 'dynamic' ? { schedule, durationDays: value.durationDays ?? STARTING_DURATION } : { schedule });
          }}
        />
        <p className="text-caption text-ink-2">{t('taskSheet.scheduleHint')}</p>
      </div>
      {dynamic ? (
        <div className="flex flex-col gap-1.5">
          <DurationField id={`${idPrefix}-duration`} label={t('taskSheet.duration')} value={value.durationDays} onCommit={(durationDays) => onPatch({ durationDays })} />
          <p className="tabular text-footnote text-ink-2" aria-live="polite">
            {due && value.durationDays
              ? t('taskSheet.computedDue', { date: formatDay(due, lang, 'withWeekday'), duration: durationText(value.durationDays, t) })
              : t('taskSheet.needsStart')}
          </p>
        </div>
      ) : (
        <DateDraftField id={`${idPrefix}-due`} label={t('taskSheet.dueDate')} value={value.dueDate ?? ''} onCommit={(dueDate) => onPatch({ dueDate })} />
      )}
    </div>
  );
}

/** The same timing as plain text, for a person who cannot change it (spec 2.3: no dead controls). */
export function durationText(days: number, t: ReturnType<typeof useTranslation>['t']): string {
  return counted(t, 'taskSheet.durationValue', days);
}
