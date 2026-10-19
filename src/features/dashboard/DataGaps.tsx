import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { formatNumber } from '../../lib/dates';
import { AttentionCard, ROW } from './AttentionCard';
import { withFilters, type DashboardData, type DashboardFilters } from './Tiles';

const GAPS = [
  { key: 'noDueDate', to: '/tasks?filter=no_date' },
  { key: 'noLead', to: '/tasks?filter=no_lead' },
  { key: 'projectsStageNoEnd', to: '/projects?filter=stage_no_end' },
  { key: 'noArea', to: '/projects?filter=no_area' },
  { key: 'noSubCompany', to: '/projects?filter=no_sub_company' },
] as const;

/**
 * What the Admin must fill in, in the active projects of the filters (owner, 2026-10-06). The server sends the gaps to the Admin
 * only; for anyone else they are null, so the card is not there. Only the gaps above 0 show, and each one opens its list.
 */
export function DataGaps({ view, filters }: { view: DashboardData; filters: DashboardFilters }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { gaps } = view;
  if (!gaps) return null;
  // noSubCompany is missing from an older answer, and it is 0 for an office with no sub-company.
  const countOf = (key: (typeof GAPS)[number]['key']) => gaps[key] ?? 0;
  const rows = GAPS.filter((gap) => countOf(gap.key) > 0);
  if (rows.length === 0) return null;
  return (
    <AttentionCard title={t('dashboard.gaps.title')} count={rows.reduce((sum, gap) => sum + countOf(gap.key), 0)}>
      {rows.map((gap) => (
        <li key={gap.key}>
          <Link to={withFilters(gap.to, filters)} className={ROW}>
            <span className="min-w-0 flex-1 text-subheadline text-ink">{t(`dashboard.gaps.${gap.key}`)}</span>
            <span className="tabular text-headline text-ink">{formatNumber(countOf(gap.key), lang)}</span>
            {/* The chevron of the number rows, so a gap row looks pressable too (review, 2026-10-06). */}
            <AnimatedIcon icon={ChevronRightIcon} size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
          </Link>
        </li>
      ))}
    </AttentionCard>
  );
}
