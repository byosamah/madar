import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { CountUp } from '../../components/CountUp';
import { formatNumber } from '../../lib/dates';
import { withFilters, type DashboardData, type DashboardFilters } from './Tiles';

/** Three numbers in one panel (redesign spec 3.6). Each one opens the list behind it. */
export function Numbers({ view, filters }: { view: DashboardData; filters: DashboardFilters }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { tiles } = view;
  const count = (n: number) => formatNumber(n, lang);
  const cell = 'pressable flex flex-col items-start gap-1 px-5 py-4 text-start hover:bg-fill/50';
  const label = 'text-footnote font-medium text-ink-2';
  const big = 'text-[calc(34px*var(--boost))] font-bold leading-none tracking-[-0.02em]';
  return (
    <ul className="panel grid grid-cols-1 divide-y divide-hairline overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
      <li>
        <Link to={withFilters('/projects?status=active', filters)} className={cell}>
          <span className={label}>{t('dashboard.tiles.activeProjects')}</span>
          <span className={`${big} text-ink`}><CountUp id="dash-active" value={tiles.activeProjects} format={count} /></span>
        </Link>
      </li>
      <li>
        <Link to={withFilters('/projects?filter=at_risk', filters)} className={cell}>
          <span className={label}>{t('dashboard.tiles.atRiskOrLate')}</span>
          <span className={`${big} ${tiles.atRiskOrLate > 0 ? 'text-attn' : 'text-ink'}`}><CountUp id="dash-attention" value={tiles.atRiskOrLate} format={count} /></span>
        </Link>
      </li>
      <li>
        {/* The Task list reads the team, so the list has the tasks this number counts (audit 2026-10-03, V-37b). */}
        <Link to={withFilters('/tasks?filter=overdue', filters)} className={cell}>
          <span className={label}>{t('dashboard.tiles.overdueTasks')}</span>
          <span className={`${big} ${tiles.overdueTasks > 0 ? 'text-attn' : 'text-ink'}`}><CountUp id="dash-past-due" value={tiles.overdueTasks} format={count} /></span>
        </Link>
      </li>
    </ul>
  );
}

/**
 * Rows with a number that open a list: deadlines in 14 days and the area in design. A note after the number says what the number
 * leaves out, for example the projects with no area (owner, 2026-10-06). On a phone the note goes under the number.
 */
export function NumberRows({ rows }: { rows: { key: string; label: string; value: string; note?: string; to: string }[] }) {
  return (
    <ul className="panel hairline overflow-hidden">
      {rows.map((row) => (
        <li key={row.key}>
          <Link to={row.to} className="pressable flex min-h-14 items-center gap-3 px-5 py-2 hover:bg-fill/50">
            {/* The label keeps its line. On a phone the note goes under the number; on a desk it sits beside it, after a dot. */}
            <span className="shrink-0 text-subheadline font-medium text-ink">{row.label}</span>
            <span className="flex min-w-0 flex-1 flex-col items-end text-end sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-end sm:gap-x-1.5">
              <span className="tabular text-headline text-ink">{row.value}</span>
              {row.note && (
                <span className="text-footnote text-ink-2">
                  {/* A note on its own line starts with no lone dot (review, 2026-10-06). */}
                  {' '}<span aria-hidden className="hidden sm:inline">· </span>{row.note}
                </span>
              )}
            </span>
            <AnimatedIcon icon={ChevronRightIcon} size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
