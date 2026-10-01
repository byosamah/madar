import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { Avatar } from '../../components/Avatar';
import { addDays, formatDay, formatNumber } from '../../lib/dates';
import type { DashboardData } from './Tiles';

/** People and the next 4 weeks: open tasks due in each week. Above the limit, the cell says "Over" in the attention color (redesign spec 2.3). */
export function Workload({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { weeks, limit, rows } = view.workload;
  return (
    <section aria-labelledby="dash-workload" className="panel flex flex-col gap-2 p-5">
      <h2 id="dash-workload" className="text-headline text-ink">{t('dashboard.workload')}</h2>
      <p className="text-footnote text-ink-2">{t('dashboard.workloadHint', { n: limit })}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-subheadline">
          <thead>
            <tr>
              <th scope="col" className="p-2 text-start font-medium text-ink-2">{t('dashboard.person')}</th>
              {weeks.map((week) => <th key={week} scope="col" className="tabular p-2 text-center font-medium text-ink-2">{formatDay(week, lang)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user.id}>
                <th scope="row" className="p-2 text-start font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar user={row.user} size={24} />
                    <bdi className="truncate">{row.user.name}</bdi>
                  </span>
                </th>
                {row.counts.map((count, i) => {
                  const over = row.over[i];
                  const label = t('dashboard.cell', { name: row.user.name, week: formatDay(weeks[i], lang), n: count });
                  return (
                    <td key={weeks[i]} className="p-1 text-center">
                      <Link
                        to={`/tasks?owner=${row.user.id}&from=${weeks[i]}&to=${addDays(weeks[i], 6)}`}
                        aria-label={over ? `${label}, ${t('dashboard.over')}` : label}
                        className={`pressable inline-flex min-h-11 min-w-14 flex-col items-center justify-center rounded-xl px-2 leading-tight ${over ? 'bg-attn-bg font-bold text-attn ring-1 ring-inset ring-attn/40' : 'bg-fill text-ink'}`}
                      >
                        <span className="tabular">{formatNumber(count, lang)}</span>
                        {over && <span aria-hidden className="text-caption">{t('dashboard.overShort')}</span>}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
