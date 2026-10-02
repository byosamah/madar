import { Fragment, useState } from 'react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { ExternalLinkIcon } from '../../components/icons/animated/external-link';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePersistentChoice } from '../../app/choices';
import { useLang } from '../../app/lang';
import { SegmentedControl } from '../../components/SegmentedControl';
import { formatDay, formatMonth, todayISO } from '../../lib/dates';
import { projectHue } from '../../lib/projectColor';
import { clipSpan, offsetPct, scheduleWindow, widthPct, ZOOMS, type Span } from '../../lib/schedule';
import { stageOverlaps, type Overlap } from '../../lib/stageFlow';
import type { DashboardData } from './Tiles';

type Row = DashboardData['schedule'][number];

/** The shared days of two stages, hatched. It sits over the bars of both stages, and has a word for a screen reader on the row's name. */
function OverlapMarks({ overlaps, span, only }: { overlaps: Overlap[]; span: Span; only?: string }) {
  return (
    <>
      {overlaps.filter((overlap) => !only || overlap.stageIds.includes(only)).map((overlap) => {
        const part = clipSpan(overlap, span);
        if (!part) return null;
        return (
          <span
            key={overlap.stageIds.join('-')}
            style={{ insetInlineStart: `${offsetPct(span, part.start)}%`, width: `${widthPct(span, part.start, part.end)}%` }}
            className="overlap-hatch absolute top-3.5 h-4 rounded-full opacity-60"
          />
        );
      })}
    </>
  );
}

/** One line for each stage of an opened project, so stages that run at the same time show side by side. */
function StageLines({ row, span, todayAt, current, overlaps }: { row: Row; span: Span; todayAt: { insetInlineStart: string }; current: number; overlaps: Overlap[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <>
      {row.stages.map((stage, i) => {
        const part = stage.startDate && stage.endDate ? clipSpan({ start: stage.startDate, end: stage.endDate }, span) : null;
        const tone = i < current ? 'bg-ink-2/35' : i === current ? '' : 'ring-1 ring-inset ring-chart-muted';
        return (
          <Fragment key={stage.id}>
            <div className="flex min-h-11 min-w-0 items-center ps-6 text-footnote text-ink-2">
              <bdi className="truncate">{stage.name}</bdi>
              {stage.startDate && stage.endDate && <span className="sr-only">{`, ${t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })}`}</span>}
            </div>
            <div aria-hidden className="relative min-h-11">
              <span style={todayAt} className="absolute inset-y-0 w-0.5 rounded-full bg-ink/70" />
              {part && (
                <span
                  title={stage.name}
                  style={{ insetInlineStart: `${offsetPct(span, part.start)}%`, width: `${widthPct(span, part.start, part.end)}%`, ...(i === current ? { background: `var(--p-${projectHue(row.project.id)}-fg)` } : {}) }}
                  className={`absolute top-3.5 h-4 rounded-full ${tone}`}
                />
              )}
              <OverlapMarks overlaps={overlaps} span={span} only={stage.id} />
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/** Every active project on one time scale, with a zoom. Time runs toward the end side, so Arabic reads right to left (spec 8.5). */
export function OfficeSchedule({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [zoom, setZoom] = usePersistentChoice('madar.office.zoom', ZOOMS, 'quarter');
  // A project shows its stages on one line. A press opens it to one line for each stage, so stages that overlap are plain to see.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpened((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const today = todayISO();
  const { span, ticks } = scheduleWindow(today, zoom);
  const todayAt = { insetInlineStart: `${offsetPct(span, today)}%` };
  return (
    <section aria-labelledby="dash-schedule" className="panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-schedule" className="text-headline text-ink">{t('dashboard.schedule')}</h2>
        <SegmentedControl label={t('dashboard.zoom')} value={zoom} onChange={setZoom} options={ZOOMS.map((value) => ({ value, label: t(`dashboard.zooms.${value}`) }))} />
      </div>
      {view.schedule.length > 0 && (
        // Every color and mark has a word (spec 10.3, WCAG 1.4.1). The stage and deadline names stay in each row's title.
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-ink-2">
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-5 rounded-full bg-ink-2/35" />{t('dashboard.legend.done')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-5 rounded-full bg-[var(--p-blue-fg)]" />{t('dashboard.legend.current')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-5 rounded-full ring-1 ring-inset ring-chart-muted" />{t('dashboard.legend.next')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rotate-45 rounded-sm bg-attn" />{t('dashboard.legend.deadline')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3.5 w-0.5 rounded-full bg-ink" />{t('dashboard.legend.today')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="overlap-hatch h-2.5 w-5 rounded-full opacity-60" />{t('dashboard.legend.overlap')}</li>
        </ul>
      )}
      {view.schedule.length === 0 ? <p className="text-footnote text-ink-2">{t('dashboard.noData')}</p> : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-[14rem_minmax(0,1fr)] gap-x-3">
            <div />
            <div aria-hidden className="relative h-6">
              {ticks.map((tick) => (
                <span key={tick} style={{ insetInlineStart: `${offsetPct(span, tick)}%` }} className="absolute top-0 whitespace-nowrap border-s border-separator ps-1 text-caption text-ink-2">
                  {zoom === 'month' ? formatDay(tick, lang) : formatMonth(tick, lang)}
                </span>
              ))}
            </div>
            {view.schedule.map((row) => {
              const current = row.stages.findIndex((stage) => stage.id === row.currentStageId);
              const isOpen = opened.has(row.project.id);
              const overlaps = stageOverlaps(row.stages);
              return (
                <Fragment key={row.project.id}>
                  <div className="flex min-h-11 min-w-0 items-center gap-1 rounded-xl hover:bg-fill">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggle(row.project.id)}
                      className="pressable flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-xl px-2 text-start"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="tabular block text-caption text-ink-2">{row.project.code}</span>
                        <bdi className="block truncate text-subheadline text-ink">{row.project.name}</bdi>
                        <span className="sr-only">{t('dashboard.expandHint')}</span>
                      </span>
                      <AnimatedIcon icon={ChevronDownIcon} size={16} aria-hidden className={`shrink-0 text-ink-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <Link to={`/projects/${row.project.id}`} aria-label={t('dashboard.meeting.openProjectOf', { name: row.project.name })} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink">
                      <AnimatedIcon icon={ExternalLinkIcon} size={16} aria-hidden />
                    </Link>
                  </div>
                  <div aria-hidden className="relative min-h-11">
                    <span style={todayAt} className="absolute inset-y-0 w-0.5 rounded-full bg-ink/70" />
                    {row.stages.map((stage, i) => {
                      if (!stage.startDate || !stage.endDate) return null;
                      const part = clipSpan({ start: stage.startDate, end: stage.endDate }, span);
                      if (!part) return null;
                      const tone = i < current ? 'bg-ink-2/35' : i === current ? '' : 'ring-1 ring-inset ring-chart-muted';
                      return (
                        <span
                          key={stage.id}
                          title={stage.name}
                          style={{ insetInlineStart: `${offsetPct(span, part.start)}%`, width: `${widthPct(span, part.start, part.end)}%`, ...(i === current ? { background: `var(--p-${projectHue(row.project.id)}-fg)` } : {}) }}
                          className={`absolute top-3.5 h-4 rounded-full ${tone}`}
                        />
                      );
                    })}
                    <OverlapMarks overlaps={overlaps} span={span} />
                    {row.deadlines.filter((d) => d.date >= span.start && d.date <= span.end).map((d) => (
                      <span
                        key={d.id}
                        title={d.name}
                        style={{ insetInlineStart: `calc(${offsetPct(span, d.date)}% - 5px)` }}
                        className="absolute top-4 size-2.5 rotate-45 rounded-sm bg-attn"
                      />
                    ))}
                  </div>
                  {isOpen && <StageLines row={row} span={span} todayAt={todayAt} current={current} overlaps={overlaps} />}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
