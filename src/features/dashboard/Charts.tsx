import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useLang } from '../../app/lang';
import { addDays, formatDay, formatNumber } from '../../lib/dates';
import type { DashboardData } from './Tiles';

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="surface flex min-w-0 flex-col gap-3 rounded-card p-4">
      <h2 id={id} className="text-headline">{title}</h2>
      {children}
    </section>
  );
}

function NoData() {
  const { t } = useTranslation();
  return <p className="text-footnote text-label-2">{t('dashboard.noData')}</p>;
}

/** One bar with its label and value. The whole row is a link to the list behind it (spec 8.3). */
function BarRow({ to, label, value, max, detail }: { to: string; label: string; value: number; max: number; detail: string }) {
  return (
    <li>
      <Link to={to} className="pressable grid min-h-11 grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 hover:bg-fill">
        <bdi className="truncate text-subheadline">{label}</bdi>
        <span aria-hidden className="h-2.5 rounded-full bg-fill">
          <span className="block h-full rounded-full bg-accent-fill" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
        </span>
        <span className="tabular text-subheadline">{detail}</span>
      </Link>
    </li>
  );
}

function PerStage({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows = view.charts.projectsPerStage;
  const max = Math.max(0, ...rows.map((row) => row.count));
  return (
    <Card title={t('dashboard.charts.perStage')}>
      {rows.length === 0 ? <NoData /> : (
        <ul>{rows.map((row) => <BarRow key={row.stage} to={`/projects?stage=${encodeURIComponent(row.stage)}`} label={row.stage} value={row.count} max={max} detail={formatNumber(row.count, lang)} />)}</ul>
      )}
    </Card>
  );
}

const HEALTH = [
  { key: 'on_track', color: 'bg-green', to: '/projects?health=on_track' },
  { key: 'at_risk', color: 'bg-orange', to: '/projects?health=at_risk' },
  { key: 'late', color: 'bg-red', to: '/projects?health=late' },
] as const;

function HealthMix({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const mix = view.charts.healthMix;
  const total = mix.on_track + mix.at_risk + mix.late;
  return (
    <Card title={t('dashboard.charts.health')}>
      {total === 0 ? <NoData /> : (
        <>
          <div aria-hidden className="flex h-4 gap-0.5 overflow-hidden rounded-full">
            {HEALTH.map((item) => mix[item.key] > 0 && <span key={item.key} className={item.color} style={{ width: `${(mix[item.key] / total) * 100}%` }} />)}
          </div>
          <ul className="flex flex-wrap gap-2">
            {HEALTH.map((item) => (
              <li key={item.key}>
                <Link to={item.to} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-fill px-3 text-subheadline">
                  <span aria-hidden className={`size-2.5 rounded-full ${item.color}`} />
                  {t(`health.${item.key}`)}
                  <span className="tabular font-semibold">{formatNumber(mix[item.key], lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Throughput({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const rows = view.charts.throughput.map((week) => ({ ...week, label: formatDay(week.weekStart, lang), end: addDays(week.weekStart, 6) }));
  const doneLink = (row: (typeof rows)[number]) => `/tasks?doneFrom=${row.weekStart}&doneTo=${row.end}`;
  const createdLink = (row: (typeof rows)[number]) => `/tasks?createdFrom=${row.weekStart}&createdTo=${row.end}`;
  const rtl = lang === 'ar';
  return (
    <Card title={t('dashboard.charts.throughput')}>
      {rows.every((row) => row.created === 0 && row.done === 0) ? <NoData /> : (
        <>
          <div className="flex gap-4 text-footnote text-label-2" aria-hidden>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-muted" />{t('dashboard.created')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent-fill" />{t('dashboard.done')}</span>
          </div>
          <div aria-hidden className="h-52">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 208 }}>
              {/* No keyboard layer: the chart is hidden from screen readers, and the table below carries the same numbers and links. */}
              <BarChart data={rows} margin={{ top: 4, bottom: 0 }} accessibilityLayer={false}>
                <XAxis dataKey="label" reversed={rtl} tick={{ fill: 'var(--c-label-2)', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} orientation={rtl ? 'right' : 'left'} width={28} tick={{ fill: 'var(--c-label-2)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Bar dataKey="created" fill="var(--c-chart-muted)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" fill="var(--c-accent-fill)" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(bar) => navigate(doneLink(bar.payload as (typeof rows)[number]))} />
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

function HoursPerProject({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows = view.charts.hoursPerProject;
  const max = Math.max(0, ...rows.map((row) => row.hours));
  return (
    <Card title={t('dashboard.charts.hoursPerProject')}>
      {rows.length === 0 ? <NoData /> : (
        <ul>
          {rows.map((row) => (
            <BarRow
              key={row.projectId}
              to={`/projects/${row.projectId}?tab=team`}
              label={`${row.code} · ${row.name}`}
              value={row.hours}
              max={max}
              detail={t('dashboard.hoursValue', { n: formatNumber(row.hours, lang, 1) })}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Four charts; a click on any bar opens the list behind it (spec 8.3). */
export function Charts({ view }: { view: DashboardData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PerStage view={view} />
      <HealthMix view={view} />
      <Throughput view={view} />
      <HoursPerProject view={view} />
    </div>
  );
}
