import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import { Avatar } from '../../components/Avatar';
import { addDays, formatDay, formatNumber, maxDay, todayISO } from '../../lib/dates';
import { counted } from '../../lib/grammar';
import { withFilters, type DashboardData, type DashboardFilters } from './Tiles';

const CELL = 'pressable inline-flex min-h-11 min-w-14 flex-col items-center justify-center rounded-xl px-2 leading-tight';

/**
 * People and their work: the past-due tasks first, then the open tasks due in each of the next 4 weeks, from today, so a task
 * counts once. The first week also holds the tasks in review that the person reviews. Above the limit, a week cell says "Over"
 * in the attention colour (redesign spec 2.3; owner, 2026-10-06). A person with nothing in any column is left out, and one quiet
 * line says how many.
 */
export function Workload({ view, filters }: { view: DashboardData; filters: DashboardFilters }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const { weeks, limit } = view.workload;
  const today = todayISO();
  // The first week starts today, so its column names today.
  const starts = weeks.map((week) => maxDay(week, today));
  // The rows in the order of the shown names (owner item 12).
  const all = [...view.workload.rows].sort((a, b) => byName(a.user, b.user));
  const rows = all.filter((row) => row.overdue > 0 || row.counts.some((count) => count > 0));
  const idle = all.length - rows.length;
  return (
    <section aria-labelledby="dash-workload" className="panel flex flex-col gap-2 p-5">
      <h2 id="dash-workload" className="text-headline text-ink">{t('dashboard.workload')}</h2>
      <p className="text-footnote text-ink-2">{t('dashboard.workloadHint', { n: limit })}</p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-subheadline">
            <thead>
              <tr>
                <th scope="col" className="p-2 text-start font-medium text-ink-2">{t('dashboard.person')}</th>
                <th scope="col" className="p-2 text-center font-medium text-ink-2">{t('dashboard.overdueColumn')}</th>
                {starts.map((start) => <th key={start} scope="col" className="tabular p-2 text-center font-medium text-ink-2">{formatDay(start, lang)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = nameOf(row.user);
                const late = row.overdue > 0;
                return (
                  <tr key={row.user.id}>
                    <th scope="row" className="p-2 text-start font-normal">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar user={row.user} size={24} />
                        <bdi className="truncate">{name}</bdi>
                      </span>
                    </th>
                    <td className="p-1 text-center">
                      <Link
                        to={withFilters(`/tasks?filter=overdue&owner=${row.user.id}`, filters)}
                        aria-label={t('dashboard.overdueCell', { name, tasks: counted(t, 'dashboard.cellTasks', row.overdue) })}
                        className={`${CELL} ${late ? 'bg-attn-bg font-semibold text-attn' : 'bg-fill text-ink'}`}
                      >
                        <span className="tabular">{formatNumber(row.overdue, lang)}</span>
                      </Link>
                    </td>
                    {row.counts.map((count, i) => {
                      const over = row.over[i];
                      // The count has its own key, so one task reads "1 task" and Arabic gets its noun forms (audit 2026-10-03, F-10).
                      const label = t('dashboard.cell', { name, week: formatDay(starts[i], lang), tasks: counted(t, 'dashboard.cellTasks', count) });
                      return (
                        <td key={weeks[i]} className="p-1 text-center">
                          <Link
                            // The work of the person in that week, in the projects of the Dashboard filters (audit V-37b; owner, 2026-10-06).
                            to={withFilters(`/tasks?work=${row.user.id}&from=${starts[i]}&to=${addDays(weeks[i], 6)}`, filters)}
                            aria-label={over ? `${label}, ${t('dashboard.over')}` : label}
                            className={`${CELL} ${over ? 'bg-attn-bg font-bold text-attn ring-1 ring-inset ring-attn/40' : 'bg-fill text-ink'}`}
                          >
                            <span className="tabular">{formatNumber(count, lang)}</span>
                            {over && <span aria-hidden className="text-caption">{t('dashboard.overShort')}</span>}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {idle > 0 && <p className="text-footnote text-ink-2">{counted(t, 'dashboard.idlePeople', idle)}</p>}
    </section>
  );
}
