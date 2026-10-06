import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useLang } from '../../app/lang';
import { addDays, formatDay, formatNumber } from '../../lib/dates';
import { withFilters, type DashboardData, type DashboardFilters } from './Tiles';

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="panel flex min-w-0 flex-col gap-3 p-5">
      <h2 id={id} className="text-headline text-ink">{title}</h2>
      {children}
    </section>
  );
}

function NoData() {
  const { t } = useTranslation();
  return <p className="text-footnote text-ink-2">{t('dashboard.noData')}</p>;
}

/** One bar with its label and value. The whole row is a link to the list behind it (spec 8.3). */
function BarRow({ to, label, value, max, detail }: { to: string; label: string; value: number; max: number; detail: string }) {
  return (
    <li>
      <Link to={to} className="pressable grid min-h-11 grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 hover:bg-fill">
        <bdi className="truncate text-subheadline">{label}</bdi>
        <span aria-hidden className="h-2 overflow-hidden rounded-full bg-fill">
          <span className="draw-line block h-full rounded-full bg-ink/60" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
        </span>
        <span className="tabular text-subheadline">{detail}</span>
      </Link>
    </li>
  );
}

export function PerStage({ view, filters }: { view: DashboardData; filters: DashboardFilters }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows = view.charts.projectsPerStage;
  const max = Math.max(0, ...rows.map((row) => row.count));
  return (
    <Card title={t('dashboard.charts.perStage')}>
      {rows.length === 0 ? <NoData /> : (
        <ul>{rows.map((row) => <BarRow key={row.stage} to={withFilters(`/projects?stage=${encodeURIComponent(row.stage)}`, filters)} label={row.stage} value={row.count} max={max} detail={formatNumber(row.count, lang)} />)}</ul>
      )}
    </Card>
  );
}

/** A number on the axis of the weekly chart. No "0": the bars start at the base line, and a "0" there touched the first week label. */
export function yAxisTick(value: number): string {
  return value === 0 ? '' : String(value);
}

export function Throughput({ view, filters }: { view: DashboardData; filters: DashboardFilters }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const rows = view.charts.throughput.map((week) => ({ ...week, label: formatDay(week.weekStart, lang), end: addDays(week.weekStart, 6) }));
  // The weeks count the tasks of the team's projects, so the Task list gets the team too (audit 2026-10-03, V-37b).
  const doneLink = (row: (typeof rows)[number]) => withFilters(`/tasks?doneFrom=${row.weekStart}&doneTo=${row.end}`, filters);
  const createdLink = (row: (typeof rows)[number]) => withFilters(`/tasks?createdFrom=${row.weekStart}&createdTo=${row.end}`, filters);
  const rtl = lang === 'ar';
  return (
    <Card title={t('dashboard.charts.throughput')}>
      {rows.every((row) => row.created === 0 && row.done === 0) ? <NoData /> : (
        <>
          <div className="flex gap-4 text-footnote text-ink-2" aria-hidden>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-muted" />{t('dashboard.created')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ink" />{t('dashboard.done')}</span>
          </div>
          <div aria-hidden className="h-52">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 208 }}>
              {/* No keyboard layer: the chart is hidden from screen readers, and the table below carries the same numbers and links. */}
              <BarChart data={rows} margin={{ top: 4, bottom: 0 }} accessibilityLayer={false}>
                <XAxis dataKey="label" reversed={rtl} tick={{ fill: 'var(--c-ink-2)', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tickFormatter={yAxisTick} orientation={rtl ? 'right' : 'left'} width={28} tick={{ fill: 'var(--c-ink-2)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Bar dataKey="created" fill="var(--c-chart-muted)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" fill="var(--c-ink)" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(bar) => navigate(doneLink(bar.payload as (typeof rows)[number]))} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* The same numbers as a table, for keyboard and screen reader use. It shows when a link in it gets the focus. */}
          <div className="sr-only focus-within:not-sr-only">
            <table className="w-full text-footnote">
              <thead>
                <tr>
                  <th scope="col" className="text-start">{t('dashboard.week', { date: '' })}</th>
                  <th scope="col">{t('dashboard.created')}</th>
                  <th scope="col">{t('dashboard.done')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.weekStart}>
                    <th scope="row" className="text-start font-normal">{t('dashboard.week', { date: row.label })}</th>
                    <td className="text-center"><Link to={createdLink(row)} aria-label={`${t('dashboard.created')} ${row.created}`} className="tabular">{row.created}</Link></td>
                    <td className="text-center"><Link to={doneLink(row)} aria-label={`${t('dashboard.done')} ${row.done}`} className="tabular">{row.done}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

