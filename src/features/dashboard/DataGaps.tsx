import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { formatNumber } from '../../lib/dates';
import { AttentionCard, ROW } from './AttentionCard';
import { withFilters, type DashboardData, type DashboardFilters } from './Tiles';

const GAPS = [
  { key: 'noDueDate', to: '/tasks?filter=no_date' },
  { key: 'noLead', to: '/tasks?filter=no_lead' },
  { key: 'stagesNoEnd', to: '/projects?filter=stage_no_end' },
  { key: 'noArea', to: '/projects?filter=no_area' },
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
  const rows = GAPS.filter((gap) => gaps[gap.key] > 0);
  if (rows.length === 0) return null;
  return (
    <AttentionCard title={t('dashboard.gaps.title')} count={rows.reduce((sum, gap) => sum + gaps[gap.key], 0)}>
      {rows.map((gap) => (
        <li key={gap.key}>
          <Link to={withFilters(gap.to, filters)} className={ROW}>
            <span className="min-w-0 flex-1 text-subheadline text-ink">{t(`dashboard.gaps.${gap.key}`)}</span>
            <span className="tabular text-headline text-ink">{formatNumber(gaps[gap.key], lang)}</span>
          </Link>
        </li>
      ))}
    </AttentionCard>
  );
}
