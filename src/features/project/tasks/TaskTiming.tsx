import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSchedule } from '../../../api/contract/entities';
import { useLang } from '../../../app/lang';
import { DateDraftField } from '../../../components/DateDraftField';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../../components/icons/animated/chevron-down';
import { spring } from '../../../design/motion';
import { TextField } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { formatDay } from '../../../lib/dates';
import { counted } from '../../../lib/grammar';
import { dueFromDuration } from '../../../lib/workdays';
import { DateRow } from './DetailRows';

export type Timing = { startDate: string | null; schedule: TaskSchedule; durationDays: number | null; dueDate: string | null };

/** A first guess for a task that turns dynamic: one working week. */
const STARTING_DURATION = 5;

/**
 * A whole number of working days, saved when the person leaves the field or presses Enter. With `row` it is a row of the phone panel: the
 * label at the start and the number at the end.
 */
export function DurationField({ id, label, value, onCommit, row = false }: { id: string; label: string; value: number | null; onCommit: (days: number) => void; row?: boolean }) {
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
  if (row) {
    return (
      <label className="flex min-h-12 items-center justify-between gap-3 px-4 py-1">
        <span className="min-w-0 flex-1 text-body">{label}</span>
        <input
          id={id}
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
          className="tabular min-h-11 w-24 rounded-xl bg-transparent px-2 text-end text-body outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-link"
        />
      </label>
    );
  }
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
export function TaskTiming({ idPrefix, value, onPatch, layout = 'plain' }: {
  idPrefix: string; value: Timing; onPatch: (changes: Partial<Timing>) => void;
  /** `rows` is the phone layout (Direction D): a fragment of rows for a Group of the task panel. The desk layout is the default. */
  layout?: 'plain' | 'rows';
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const dynamic = value.schedule === 'dynamic';
  // The saved due date is the server's answer. A form that is not saved yet counts it here, for the words only.
  const due = value.dueDate ?? (value.startDate && value.durationDays ? dueFromDuration(value.startDate, value.durationDays) : null);
  if (layout === 'rows') return <TimingRows idPrefix={idPrefix} value={value} onPatch={onPatch} due={due} />;
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

/**
 * The rows of the timing: Start, then Timing (a row that opens the two choices in place, with the hint), then Due for Static, or Duration
 * and the computed due line for Dynamic. The patches are the ones of the desk layout.
 */
function TimingRows({ idPrefix, value, onPatch, due }: { idPrefix: string; value: Timing; onPatch: (changes: Partial<Timing>) => void; due: string | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const dynamic = value.schedule === 'dynamic';
  return (
    <>
      <DateRow id={`${idPrefix}-start`} label={t('taskSheet.startDate')} value={value.startDate ?? ''} onCommit={(startDate) => onPatch({ startDate })} />
      <div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          className="pressable flex min-h-12 w-full items-center justify-between gap-3 px-4 py-1.5 text-start"
        >
          <span className="shrink-0 text-body">{t('phoneTask.timing')}</span>
          <span className="flex min-w-0 items-center justify-end gap-2 text-end text-body text-ink-2">
            {dynamic ? t('taskSheet.scheduleDynamic') : t('taskSheet.scheduleStatic')}
            <AnimatedIcon icon={ChevronDownIcon} size={16} className={`shrink-0 text-label-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              key="choices"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring.expand}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-2 px-4 pb-3">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {dynamic ? (
        <div>
          <DurationField row id={`${idPrefix}-duration`} label={t('taskSheet.duration')} value={value.durationDays} onCommit={(durationDays) => onPatch({ durationDays })} />
          <p className="tabular px-4 pb-2.5 text-footnote text-ink-2" aria-live="polite">
            {due && value.durationDays
              ? t('taskSheet.computedDue', { date: formatDay(due, lang, 'withWeekday'), duration: durationText(value.durationDays, t) })
              : t('taskSheet.needsStart')}
          </p>
        </div>
      ) : (
        <DateRow id={`${idPrefix}-due`} label={t('taskSheet.dueDate')} value={value.dueDate ?? ''} onCommit={(dueDate) => onPatch({ dueDate })} />
      )}
    </>
  );
}
