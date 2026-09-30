import { Trash } from 'lucide-react';
import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useIsPhone } from '../../../app/useIsPhone';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { SelectField, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { diffDays, formatDay, formatMonth, todayISO } from '../../../lib/dates';
import { chartRange, dayDelta, monthStarts, moveEdge, offsetPct, spanDays, widthPct, type Span } from '../../../lib/schedule';
import type { TabProps } from '../tabs';

type Edge = 'start' | 'end';

function StageBar({
  stage, span, range, current, editable, width, onPreview, onCommit,
}: {
  stage: Stage;
  span: Span;
  range: Span;
  current: boolean;
  editable: boolean;
  width: () => number;
  onPreview: (span: Span | null) => void;
  onCommit: (span: Span) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const drag = useRef<{ edge: Edge; x: number; origin: Span } | null>(null);
  const rtl = document.documentElement.dir === 'rtl';
  const total = spanDays(range);
  const daysFor = (event: PointerEvent) => dayDelta(event.clientX - (drag.current?.x ?? event.clientX), width(), total, rtl);

  const handle = (edge: Edge) => {
    const day = edge === 'start' ? span.start : span.end;
    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      onCommit(moveEdge(span, edge, step));
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
          if (drag.current) onPreview(moveEdge(drag.current.origin, drag.current.edge, daysFor(event)));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          const days = daysFor(event);
          const next = moveEdge(drag.current.origin, drag.current.edge, days);
          drag.current = null;
          if (days === 0) onPreview(null);
          else onCommit(next);
        }}
        className={`absolute inset-y-0 z-10 w-6 cursor-ew-resize touch-none rounded-full focus-visible:bg-white/40 ${edge === 'start' ? '-start-2' : '-end-2'}`}
      />
    );
  };

  return (
    <div
      title={`${stage.name}: ${formatDay(span.start, lang)} to ${formatDay(span.end, lang)}`}
      style={{ insetInlineStart: `${offsetPct(range, span.start)}%`, width: `${widthPct(range, span.start, span.end)}%` }}
      className={`absolute top-2 h-7 rounded-full ${current ? 'bg-accent-fill' : 'bg-fill-strong'}`}
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
  const [preview, setPreview] = useState<{ stageId: string; span: Span } | null>(null);
  const setDates = useUndoable('stages.setDates', { message: () => t('schedule.datesChanged') });
  const width = () => scale.current?.getBoundingClientRect().width ?? 0;
  const todayAt = { insetInlineStart: `${offsetPct(range, today)}%` };
  const todayLine = <span aria-hidden style={todayAt} className="absolute inset-y-0 w-px bg-red" />;
  return (
    <section aria-label={t('schedule.chart')} className="surface overflow-x-auto rounded-card p-4">
      <div className="grid min-w-[40rem] grid-cols-[10rem_minmax(0,1fr)] gap-x-3">
        <div />
        <div ref={scale} className="relative h-7">
          {monthStarts(range).map((month) => (
            <span key={month} aria-hidden style={{ insetInlineStart: `${offsetPct(range, month)}%` }} className="absolute top-0 border-s border-separator ps-1 text-caption text-label-2">
              {formatMonth(month, lang)}
            </span>
          ))}
          <span style={todayAt} className="absolute bottom-0 -translate-x-1/2 text-caption font-semibold text-red-text rtl:translate-x-1/2">{t('schedule.today')}</span>
        </div>
        {detail.stages.map((stage) => {
          const saved = stage.startDate && stage.endDate ? { start: stage.startDate, end: stage.endDate } : null;
          const span = preview?.stageId === stage.id ? preview.span : saved;
          return (
            <Fragment key={stage.id}>
              <div dir="auto" className="flex min-h-11 items-center truncate text-subheadline">{stage.name}</div>
              <div className="relative min-h-11">
                {todayLine}
                {span ? (
                  <StageBar
                    stage={stage}
                    span={span}
                    range={range}
                    current={stage.id === detail.currentStage.id}
                    editable={detail.viewerCan.edit}
                    width={width}
                    onPreview={(next) => setPreview(next ? { stageId: stage.id, span: next } : null)}
                    onCommit={(next) => {
                      setPreview(null);
                      setDates.mutate({ stageId: stage.id, startDate: next.start, endDate: next.end });
                    }}
                  />
                ) : <span className="flex h-11 items-center text-footnote text-label-2">{t('project.noDates')}</span>}
              </div>
            </Fragment>
          );
        })}
        <div className="flex min-h-11 items-center text-subheadline text-label-2">{t('schedule.deadlines')}</div>
        <div className="relative min-h-11" aria-hidden>
          {todayLine}
          {detail.deadlines.map((deadline) => (
            <span
              key={deadline.id}
              title={`${deadline.name} · ${formatDay(deadline.date, lang)}`}
              style={{ insetInlineStart: `calc(${offsetPct(range, deadline.date)}% - 6px)` }}
              className="absolute top-4 size-3 rotate-45 rounded-sm bg-orange"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Stage dates as a list: the phone view, and date fields for the leader on every screen size. */
function StageDates({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const setDates = useUndoable('stages.setDates', { message: () => t('schedule.datesChanged') });
  const edit = detail.viewerCan.edit;
  return (
    <section aria-labelledby="schedule-stages" className="surface rounded-card p-4">
      <h2 id="schedule-stages" className="text-headline">{t('schedule.stages')}</h2>
      <ul className="mt-2 flex flex-col gap-3">
        {detail.stages.map((stage) => (
          <li key={stage.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <span dir="auto" className="min-w-0 flex-1 text-subheadline font-medium">{stage.name}</span>
            {edit ? (
              <>
                <TextField id={`start-${stage.id}`} type="date" label={t('schedule.startOf', { stage: stage.name })} value={stage.startDate ?? ''}
                  onChange={(event) => setDates.mutate({ stageId: stage.id, startDate: event.target.value || null, endDate: stage.endDate })} />
                <TextField id={`end-${stage.id}`} type="date" label={t('schedule.endOf', { stage: stage.name })} value={stage.endDate ?? ''}
                  onChange={(event) => setDates.mutate({ stageId: stage.id, startDate: stage.startDate, endDate: event.target.value || null })} />
              </>
            ) : (
              <span className="tabular text-footnote text-label-2">
                {stage.startDate && stage.endDate
                  ? t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })
                  : t('project.noDates')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
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
  const today = todayISO();
  return (
    <section aria-labelledby="schedule-deadlines" className="surface rounded-card p-4">
      <h2 id="schedule-deadlines" className="text-headline">{t('schedule.deadlines')}</h2>
      {detail.deadlines.length === 0 ? <p className="mt-2 text-footnote text-label-2">{t('schedule.noDeadlines')}</p> : (
        <ul className="mt-1">
          {detail.deadlines.map((deadline) => (
            <li key={deadline.id} className="flex min-h-11 items-center gap-3">
              <span aria-hidden className="size-2.5 shrink-0 rotate-45 rounded-sm bg-orange" />
              <bdi className="min-w-0 flex-1 truncate text-subheadline">{deadline.name}</bdi>
              <span className={`tabular text-footnote ${deadline.date < today ? 'text-label-2' : ''}`}>{formatDay(deadline.date, lang)}</span>
              {detail.viewerCan.edit && (
                <IconButton label={t('schedule.deleteDeadline', { name: deadline.name })} onClick={() => remove.mutate({ id: deadline.id })}>
                  <Trash size={16} aria-hidden />
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
          <TextField id="deadline-date" type="date" label={t('schedule.deadlineDate')} value={date} onChange={(event) => setDate(event.target.value)} />
          <SelectField id="deadline-stage" label={t('schedule.deadlineStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
            <option value="">{t('files.noStage')}</option>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </SelectField>
          <Button variant="primary" type="submit" disabled={!name.trim() || !date || add.isPending}>{t('schedule.addDeadline')}</Button>
        </form>
      )}
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
