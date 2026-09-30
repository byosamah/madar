import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePersistentChoice } from '../../app/choices';
import { useLang } from '../../app/lang';
import { SegmentedControl } from '../../components/SegmentedControl';
import { formatDay, formatMonth, todayISO } from '../../lib/dates';
import { clipSpan, offsetPct, scheduleWindow, widthPct, ZOOMS } from '../../lib/schedule';
import type { DashboardData } from './Tiles';

/** Every active project on one time scale, with a zoom. Time runs toward the end side, so Arabic reads right to left (spec 8.5). */
export function OfficeSchedule({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [zoom, setZoom] = usePersistentChoice('madar.office.zoom', ZOOMS, 'quarter');
  const today = todayISO();
  const { span, ticks } = scheduleWindow(today, zoom);
  const todayAt = { insetInlineStart: `${offsetPct(span, today)}%` };
  return (
    <section aria-labelledby="dash-schedule" className="surface flex flex-col gap-3 rounded-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-schedule" className="text-headline">{t('dashboard.schedule')}</h2>
        <SegmentedControl label={t('dashboard.zoom')} value={zoom} onChange={setZoom} options={ZOOMS.map((value) => ({ value, label: t(`dashboard.zooms.${value}`) }))} />
      </div>
      {view.schedule.length > 0 && (
        // Every color and mark has a word (spec 10.3, WCAG 1.4.1). The stage and deadline names stay in each row's title.
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-label-2">
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-5 rounded-full bg-label-2" />{t('dashboard.legend.done')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-5 rounded-full bg-accent-fill" />{t('dashboard.legend.current')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-5 rounded-full ring-1 ring-inset ring-chart-muted" />{t('dashboard.legend.next')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rotate-45 rounded-sm bg-orange-text" />{t('dashboard.legend.deadline')}</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3.5 w-px bg-red" />{t('dashboard.legend.today')}</li>
        </ul>
      )}
      {view.schedule.length === 0 ? <p className="text-footnote text-label-2">{t('dashboard.noData')}</p> : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[40rem] grid-cols-[10rem_minmax(0,1fr)] gap-x-3">
            <div />
            <div aria-hidden className="relative h-6">
              {ticks.map((tick) => (
                <span key={tick} style={{ insetInlineStart: `${offsetPct(span, tick)}%` }} className="absolute top-0 whitespace-nowrap border-s border-separator ps-1 text-caption text-label-2">
                  {zoom === 'month' ? formatDay(tick, lang) : formatMonth(tick, lang)}
                </span>
              ))}
            </div>
            {view.schedule.map((row) => {
              const current = row.stages.findIndex((stage) => stage.id === row.currentStageId);
              return (
                <Fragment key={row.project.id}>
                  <Link to={`/projects/${row.project.id}`} className="flex min-h-11 min-w-0 flex-col justify-center rounded-xl px-2 hover:bg-fill">
                    <span className="tabular text-caption text-label-2">{row.project.code}</span>
                    <bdi className="truncate text-subheadline">{row.project.name}</bdi>
                  </Link>
                  <div aria-hidden className="relative min-h-11">
                    <span style={todayAt} className="absolute inset-y-0 w-px bg-red" />
                    {row.stages.map((stage, i) => {
                      if (!stage.startDate || !stage.endDate) return null;
                      const part = clipSpan({ start: stage.startDate, end: stage.endDate }, span);
                      if (!part) return null;
                      const tone = i < current ? 'bg-label-2' : i === current ? 'bg-accent-fill' : 'ring-1 ring-inset ring-chart-muted';
                      return (
                        <span
                          key={stage.id}
                          title={stage.name}
                          style={{ insetInlineStart: `${offsetPct(span, part.start)}%`, width: `${widthPct(span, part.start, part.end)}%` }}
                          className={`absolute top-3.5 h-4 rounded-full ${tone}`}
                        />
                      );
                    })}
                    {row.deadlines.filter((d) => d.date >= span.start && d.date <= span.end).map((d) => (
                      <span
                        key={d.id}
                        title={d.name}
                        style={{ insetInlineStart: `calc(${offsetPct(span, d.date)}% - 5px)` }}
                        className="absolute top-4 size-2.5 rotate-45 rounded-sm bg-orange-text"
                      />
                    ))}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
