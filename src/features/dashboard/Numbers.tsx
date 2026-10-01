import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { CountUp } from '../../components/CountUp';
import { formatNumber } from '../../lib/dates';
import { HoursSheet, type DashboardData } from './Tiles';

/** Three numbers in one panel (redesign spec 3.6). Each one opens the list behind it. */
export function Numbers({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [hoursOpen, setHoursOpen] = useState(false);
  const { tiles } = view;
  const count = (n: number) => formatNumber(n, lang);
  const cell = 'pressable flex flex-col items-start gap-1 px-5 py-4 text-start hover:bg-fill/50';
  const label = 'text-footnote font-medium text-ink-2';
  const big = 'text-[calc(34px*var(--boost))] font-bold leading-none tracking-[-0.02em] text-ink';
  const percent = Math.min(100, tiles.officeHours.percent);
  return (
    <>
      <ul className="panel grid grid-cols-1 divide-y divide-hairline overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
        <li>
          <Link to="/projects?status=active" className={cell}>
            <span className={label}>{t('dashboard.tiles.activeProjects')}</span>
            <span className={big}><CountUp id="dash-active" value={tiles.activeProjects} format={count} /></span>
          </Link>
        </li>
        <li>
          <Link to="/projects?filter=at_risk" className={cell}>
            <span className={label}>{t('dashboard.tiles.atRiskOrLate')}</span>
            <span className={`${big} ${tiles.atRiskOrLate > 0 ? 'text-attn' : ''}`}><CountUp id="dash-attention" value={tiles.atRiskOrLate} format={count} /></span>
          </Link>
        </li>
        <li>
          <button type="button" onClick={() => setHoursOpen(true)} className={`${cell} w-full`}>
            <span className={label}>{t('dashboard.tiles.officeHours')}</span>
            <span className={big}><CountUp id="dash-hours" value={tiles.officeHours.percent} format={(n) => t('dashboard.percent', { n: formatNumber(n, lang) })} /></span>
            <span aria-hidden className="mt-1 block h-1 w-full max-w-40 overflow-hidden rounded-full bg-fill">
              <span className="draw-line block h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
            </span>
            <span className="tabular text-footnote text-ink-2">{t('dashboard.hoursOf', { hours: formatNumber(tiles.officeHours.hours, lang, 1), target: formatNumber(tiles.officeHours.target, lang) })}</span>
          </button>
        </li>
      </ul>
      <HoursSheet open={hoursOpen} onOpenChange={setHoursOpen} view={view} />
    </>
  );
}

/** Rows with a number that open a list: past-due tasks, deadlines in 14 days, area in design. */
export function NumberRows({ rows }: { rows: { key: string; label: string; value: string; to: string }[] }) {
  return (
    <ul className="panel hairline overflow-hidden">
      {rows.map((row) => (
        <li key={row.key}>
          <Link to={row.to} className="pressable flex min-h-14 items-center gap-3 px-5 hover:bg-fill/50">
            <span className="min-w-0 flex-1 text-subheadline font-medium text-ink">{row.label}</span>
            <span className="tabular text-headline text-ink">{row.value}</span>
            <ChevronRight size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
