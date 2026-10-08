import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Deadline, Stage } from '../../../api/contract/entities';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useIsPhone } from '../../../app/useIsPhone';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { DateDraftField } from '../../../components/DateDraftField';
import { DateField } from '../../../components/DateField';
import { SelectField, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { Sheet } from '../../../components/Sheet';
import { diffDays, formatDay, formatMonth, listFormat, todayISO } from '../../../lib/dates';
import { chartRange, dayDelta, monthStarts, moveEdge, offsetPct, spanDays, widthPct, type Span } from '../../../lib/schedule';
import { overlappingWith, stageOverlaps } from '../../../lib/stageFlow';
import { HatchSwitch, useHatchOverlap } from '../../dashboard/hatch';
import { currentTone } from '../../dashboard/scheduleMarks';
import { stageDatesText } from '../StageControl';
import type { TabProps } from '../tabs';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { DeleteIcon } from '../../../components/icons/animated/delete';

type Edge = 'start' | 'end';

function StageBar({
  stage, span: saved, range, place, tone, editable, width, onCommit,
}: {
  stage: Stage;
  span: Span;
  range: Span;
  place: 'done' | 'current' | 'later';
  /** The classes of the current stage: the state of the project, as on the Dashboard schedule. */
  tone: string;
  editable: boolean;
  width: () => number;
  onCommit: (span: Span, onError: () => void) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const drag = useRef<{ edge: Edge; x: number; origin: Span } | null>(null);
  const timer = useRef(0);
  // A local draft, so quick arrow presses build on each other; it goes away when the saved dates catch up (spec 10.9).
  const [draft, setDraft] = useState<Span | null>(null);
  useEffect(() => {
    if (draft && draft.start === saved.start && draft.end === saved.end) setDraft(null);
  }, [draft, saved.start, saved.end]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const span = draft ?? saved;
  const rtl = document.documentElement.dir === 'rtl';
  const total = spanDays(range);
  const daysFor = (event: PointerEvent) => dayDelta(event.clientX - (drag.current?.x ?? event.clientX), width(), total, rtl);
  const save = (next: Span) => onCommit(next, () => setDraft(null));

  const handle = (edge: Edge) => {
    const day = edge === 'start' ? span.start : span.end;
    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = moveEdge(span, edge, step);
      setDraft(next);
      // One save after the person stops pressing, so a burst of presses is one change with one Undo.
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => save(next), 400);
    };
    return (
      <span
        role="slider"
        tabIndex={0}
        aria-label={t(edge === 'start' ? 'schedule.startOf' : 'schedule.endOf', { stage: stage.name })}
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={diffDays(range.start, day)}
        aria-valuetext={formatDay(day, lang, 'long')}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { edge, x: event.clientX, origin: span };
        }}
        onPointerMove={(event) => {
          if (drag.current) setDraft(moveEdge(drag.current.origin, drag.current.edge, daysFor(event)));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          const days = daysFor(event);
          const next = moveEdge(drag.current.origin, drag.current.edge, days);
          drag.current = null;
          if (days === 0) {
            setDraft(null);
            return;
          }
          setDraft(next);
          save(next);
        }}
        className={`absolute inset-y-0 z-10 w-6 cursor-ew-resize touch-none rounded-full focus-visible:bg-white/40 ${edge === 'start' ? '-start-2' : '-end-2'}`}
      />
    );
  };

  return (
    <div
      title={t('project.stageDates', { start: formatDay(span.start, lang), end: formatDay(span.end, lang) })}
      style={{ insetInlineStart: `${offsetPct(range, span.start)}%`, width: `${widthPct(range, span.start, span.end)}%` }}
      className={`absolute top-2 h-7 rounded-full ${place === 'done' ? 'bg-ink-2/35' : place === 'later' ? 'ring-1 ring-inset ring-chart-muted' : tone}`}
    >
      {editable && handle('start')}
      {editable && handle('end')}
    </div>
  );
}

/** Stage bars on a month scale, deadlines as diamonds and a line for today. Time runs toward the end side (spec 5.6). */
function Timeline({ detail, range, today }: { detail: ProjectDetail; range: Span; today: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const scale = useRef<HTMLDivElement>(null);
  const setDates = useUndoable('stages.setDates', { message: () => t('schedule.datesChanged') });
  const width = () => scale.current?.getBoundingClientRect().width ?? 0;
  const todayAt = { insetInlineStart: `${offsetPct(range, today)}%` };
  const todayLine = <span aria-hidden style={todayAt} className="absolute inset-y-0 w-0.5 rounded-full bg-ink/70" />;
  const overlaps = stageOverlaps(detail.stages);
  const [hatch, setHatch] = useHatchOverlap();
  // The current stage says the state of the project in the tones of the Dashboard and the meeting, never the project color,
  // so an On track project never shows amber and a Late one never shows green (audit 2026-10-03, F-12).
  const paused = detail.project.status === 'on_hold';
  const tone = currentTone(paused, detail.health?.value ?? 'on_track');
  return (
    <section aria-label={t('schedule.chart')} className="panel overflow-x-auto p-5">
      {/* One small switch beside the legend. With the hatch off, the legend goes and the switch stays (owner, 2026-10-05, item 9). */}
      {overlaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 pb-1">
          {hatch && <p className="text-footnote text-ink-2">{t('schedule.overlapLegend')}</p>}
          <span className="ms-auto"><HatchSwitch on={hatch} onChange={setHatch} /></span>
        </div>
      )}
      <div className="grid min-w-[40rem] grid-cols-[10rem_minmax(0,1fr)] gap-x-3">
        <div />
        <div ref={scale} className="relative h-7">
          {monthStarts(range).map((month) => (
            <span key={month} aria-hidden style={{ insetInlineStart: `${offsetPct(range, month)}%` }} className="absolute top-0 border-s border-separator ps-1 text-caption text-ink-2">
              {formatMonth(month, lang)}
            </span>
          ))}
          <span style={todayAt} className="absolute bottom-0 -translate-x-1/2 text-caption font-semibold text-ink rtl:translate-x-1/2">{t('schedule.today')}</span>
        </div>
        {detail.stages.map((stage, index) => {
          const currentIndex = detail.stages.findIndex((item) => item.id === detail.currentStage.id);
          const saved = stage.startDate && stage.endDate ? { start: stage.startDate, end: stage.endDate } : null;
          const span = saved;
          return (
            <Fragment key={stage.id}>
              <div className="flex min-h-11 min-w-0 items-center text-subheadline"><bdi dir="auto" className="min-w-0 truncate">{stage.name}</bdi></div>
              <div className="relative min-h-11">
                {todayLine}
                {span ? (
                  <StageBar
                    stage={stage}
                    span={span}
                    range={range}
                    place={index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'later'}
                    tone={tone}
                    editable={detail.viewerCan.edit}
                    width={width}
                    onCommit={(next, onError) => setDates.mutate({ stageId: stage.id, startDate: next.start, endDate: next.end }, { onError })}
                  />
                ) : <span className="tabular flex h-11 items-center text-footnote text-ink-2">{stageDatesText(stage, t, lang)}</span>}
                {hatch && overlaps.filter((overlap) => overlap.stageIds.includes(stage.id)).map((overlap) => (
                  <span
                    key={overlap.stageIds.join('-')}
                    aria-hidden
                    style={{ insetInlineStart: `${offsetPct(range, overlap.start)}%`, width: `${widthPct(range, overlap.start, overlap.end)}%` }}
                    className="overlap-hatch absolute top-2 h-7 rounded-full opacity-60"
                  />
                ))}
              </div>
            </Fragment>
          );
        })}
        <div className="flex min-h-11 items-center text-subheadline text-ink-2">{t('schedule.deadlines')}</div>
        <div className="relative min-h-11" aria-hidden>
          {todayLine}
          {detail.deadlines.map((deadline) => (
            <span
              key={deadline.id}
              title={`${deadline.name} · ${formatDay(deadline.date, lang)}`}
              style={{ insetInlineStart: `calc(${offsetPct(range, deadline.date)}% - 6px)` }}
              // A deadline is a date, not a warning: the same quiet grey as the Dashboard and the meeting (audit 2026-10-03, V-24).
              className="absolute top-4 size-3 rotate-45 rounded-sm bg-ink-2"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** The columns of the stage dates editor: the stage name, then Start and End. The column names use the same grid, so they line up. */
const DATE_ROW = 'grid grid-cols-2 items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]';

/**
 * Stage dates as a list: the phone view, and the dates editor for the leader on every screen size. The editor has one row for
 * each stage, its name at the start, then the Start and End columns, with the column names once at the top (owner, 2026-10-05,
 * item 8). On a phone the name takes its own line over the two dates.
 */
function StageDates({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const setDates = useUndoable('stages.setDates', { message: () => t('schedule.datesChanged') });
  // A failed or refused save puts the date fields back to the saved dates (audit 2026-10-03, PRJ-7).
  const [failures, setFailures] = useState(0);
  const rollback = { onError: () => setFailures((count) => count + 1) };
  const edit = detail.viewerCan.edit;
  const list = listFormat(lang);
  const overlaps = stageOverlaps(detail.stages);
  const name = (stage: Stage) => (
    <>
      <span dir="auto" className="block text-subheadline font-medium">{stage.name}</span>
      {overlappingWith(stage.id, overlaps).length > 0 && (
        <span dir="auto" className="block text-footnote text-ink-2">
          {t('project.stageOverlap', { names: list.format(overlappingWith(stage.id, overlaps).map((id) => detail.stages.find((other) => other.id === id)?.name ?? '')) })}
        </span>
      )}
    </>
  );
  return (
    <section aria-labelledby="schedule-stages" className="panel p-5">
      <h2 id="schedule-stages" className="text-headline text-ink">{t('schedule.stages')}</h2>
      {edit ? (
        <>
          {/* The column names, once. Each date field also has its full label ("Start of Permits") for a screen reader. */}
          <div aria-hidden className={`${DATE_ROW} mt-3 text-footnote font-medium text-ink-2`}>
            <span className="hidden sm:block" />
            <span className="ps-[15px]">{t('schedule.startColumn')}</span>
            <span className="ps-[15px]">{t('schedule.endColumn')}</span>
          </div>
          <ul className="hairline mt-1">
            {detail.stages.map((stage) => (
              <li key={stage.id} className={`${DATE_ROW} gap-y-1 py-2`}>
                <span className="col-span-2 min-w-0 sm:col-span-1">{name(stage)}</span>
                <DateDraftField key={`start-${failures}`} id={`start-${stage.id}`} label={t('schedule.startOf', { stage: stage.name })} hideLabel value={stage.startDate ?? ''}
                  onCommit={(startDate) => setDates.mutate({ stageId: stage.id, startDate, endDate: stage.endDate }, rollback)} />
                <DateDraftField key={`end-${failures}`} id={`end-${stage.id}`} label={t('schedule.endOf', { stage: stage.name })} hideLabel value={stage.endDate ?? ''}
                  onCommit={(endDate) => setDates.mutate({ stageId: stage.id, startDate: stage.startDate, endDate }, rollback)} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {detail.stages.map((stage) => (
            <li key={stage.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <span className="min-w-0 flex-1">{name(stage)}</span>
              <span className="tabular text-footnote text-ink-2">{stageDatesText(stage, t, lang)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One deadline in a sheet: its name, date and stage (audit 2026-10-03, PRJ-13). Save changes it with Undo. */
function DeadlineSheet({ detail, deadline, onClose }: { detail: ProjectDetail; deadline: Deadline; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(deadline.name);
  const [date, setDate] = useState(deadline.date);
  const [stageId, setStageId] = useState(deadline.stageId ?? '');
  const save = useUndoable('deadlines.update', { message: () => t('schedule.deadlineSaved'), onSuccess: onClose });
  const ready = Boolean(name.trim() && date);
  const submit = () => {
    if (ready) save.mutate({ id: deadline.id, patch: { name: name.trim(), date, stageId: stageId || null } });
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('schedule.editDeadlineTitle')}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!ready || save.isPending} onClick={submit}>{t('common.save')}</Button>
        </>
      )}
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField id="deadline-edit-name" label={t('schedule.deadlineName')} value={name} dir="auto" onChange={(event) => setName(event.target.value)} />
        <DateField id="deadline-edit-date" label={t('schedule.deadlineDate')} clearable={false} value={date} onChange={setDate} />
        <SelectField id="deadline-edit-stage" label={t('schedule.deadlineStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
          <option value="">{t('files.noStage')}</option>
          {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </SelectField>
      </form>
    </Sheet>
  );
}

function Deadlines({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [stageId, setStageId] = useState('');
  const add = useAction('deadlines.create', {
    onSuccess: () => {
      setName('');
      setDate('');
      toast.show({ message: t('schedule.deadlineAdded') });
    },
  });
  const remove = useUndoable('deadlines.delete', { message: () => t('schedule.deadlineDeleted') });
  const [editing, setEditing] = useState<Deadline | null>(null);
  const today = todayISO();
  return (
    <section aria-labelledby="schedule-deadlines" className="panel p-5">
      <h2 id="schedule-deadlines" className="text-headline text-ink">{t('schedule.deadlines')}</h2>
      {detail.deadlines.length === 0 ? <p className="mt-2 text-footnote text-ink-2">{t('schedule.noDeadlines')}</p> : (
        <ul className="mt-1">
          {detail.deadlines.map((deadline) => (
            <li key={deadline.id} className="flex min-h-11 items-center gap-3">
              <span aria-hidden className="size-2.5 shrink-0 rotate-45 rounded-sm bg-ink-2" />
              {/* The name opens the deadline to change it, for the people who may (audit 2026-10-03, PRJ-13). */}
              {detail.viewerCan.edit ? (
                <button
                  type="button"
                  aria-label={t('schedule.editDeadline', { name: deadline.name })}
                  onClick={() => setEditing(deadline)}
                  className="pressable -mx-1 flex min-h-11 min-w-0 flex-1 items-center rounded-lg px-1 text-start text-subheadline hover:bg-fill"
                >
                  <bdi className="truncate">{deadline.name}</bdi>
                </button>
              ) : <bdi className="min-w-0 flex-1 truncate text-subheadline">{deadline.name}</bdi>}
              <span className={`tabular text-footnote ${deadline.date < today ? 'text-ink-2' : ''}`}>{formatDay(deadline.date, lang)}</span>
              {detail.viewerCan.edit && (
                <IconButton label={t('schedule.deleteDeadline', { name: deadline.name })} onClick={() => remove.mutate({ id: deadline.id })}>
                  <AnimatedIcon icon={DeleteIcon} size={16} aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.viewerCan.edit && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && date) add.mutate({ projectId: detail.project.id, name: name.trim(), date, stageId: stageId || null });
          }}
        >
          <TextField id="deadline-name" label={t('schedule.deadlineName')} value={name} dir="auto" onChange={(event) => setName(event.target.value)} />
          <DateField id="deadline-date" label={t('schedule.deadlineDate')} clearable={false} value={date} onChange={setDate} />
          <SelectField id="deadline-stage" label={t('schedule.deadlineStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
            <option value="">{t('files.noStage')}</option>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </SelectField>
          <Button type="submit" disabled={!name.trim() || !date || add.isPending}>{t('schedule.addDeadline')}</Button>
        </form>
      )}
      {editing && <DeadlineSheet key={editing.id} detail={detail} deadline={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

export function ScheduleTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const today = todayISO();
  const dated = detail.stages.some((stage) => stage.startDate && stage.endDate) || detail.deadlines.length > 0;
  const range = chartRange([
    detail.project.startDate, detail.project.targetEndDate, today,
    ...detail.stages.flatMap((stage) => [stage.startDate, stage.endDate]),
    ...detail.deadlines.map((deadline) => deadline.date),
  ]);
  return (
    <div className="flex flex-col gap-5">
      {!dated || !range
        ? <EmptyState title={t('schedule.noDatesTitle')} body={t('schedule.noDates')} />
        : !phone && <Timeline detail={detail} range={range} today={today} />}
      {(phone || detail.viewerCan.edit) && <StageDates detail={detail} />}
      <Deadlines detail={detail} />
    </div>
  );
}
