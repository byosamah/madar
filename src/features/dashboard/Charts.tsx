import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useLang } from '../../app/lang';
import { formatDay, formatNumber } from '../../lib/dates';
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

/**
 * The Tracker entries that the office sent to its clients, by week, for 12 weeks (owner, 2026-10-06). No office-wide Tracker list
 * exists, so a bar opens nothing.
 */
export function Submissions({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows = view.charts.submissions.map((week) => ({ ...week, label: formatDay(week.weekStart, lang) }));
  const rtl = lang === 'ar';
  return (
    <Card title={t('dashboard.charts.submissions')}>
      {rows.every((row) => row.count === 0) ? <NoData /> : (
        <>
          <div aria-hidden className="h-52">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 208 }}>
              {/* No keyboard layer: the chart is hidden from screen readers, and the table below carries the same numbers. */}
              <BarChart data={rows} margin={{ top: 4, bottom: 0 }} accessibilityLayer={false}>
                <XAxis dataKey="label" reversed={rtl} tick={{ fill: 'var(--c-ink-2)', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tickFormatter={yAxisTick} orientation={rtl ? 'right' : 'left'} width={28} tick={{ fill: 'var(--c-ink-2)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Bar dataKey="count" fill="var(--c-ink)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* The same numbers as a table, for screen readers. */}
          <table className="sr-only">
            <thead>
              <tr>
                <th scope="col">{t('dashboard.week', { date: '' })}</th>
                <th scope="col">{t('dashboard.submissions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.weekStart}>
                  <th scope="row">{t('dashboard.week', { date: row.label })}</th>
                  <td className="tabular">{formatNumber(row.count, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
