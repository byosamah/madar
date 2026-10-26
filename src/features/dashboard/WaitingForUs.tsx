import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ProjectTile } from '../../components/ProjectTile';
import { counted } from '../../lib/grammar';
import { AttentionCard, ROW } from './AttentionCard';
import type { DashboardData } from './Tiles';
import { useProjectName } from '../../app/projectName';

/**
 * The client items that wait for the office's reply, one row for each active project in the filters (owner, 2026-10-06). A row opens
 * the Tracker of its project, where the open items sit on top. The card is not there when nothing waits.
 */
export function WaitingForUs({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const rows = view.waitingForUs;
  if (rows.length === 0) return null;
  return (
    <AttentionCard title={t('dashboard.waitingForUs.title')} count={rows.reduce((sum, row) => sum + row.count, 0)}>
      {rows.map((row) => (
        <li key={row.project.id}>
          <Link to={`/projects/${row.project.id}?tab=tracker`} className={ROW}>
            <ProjectTile id={row.project.id} mark={row.project.mark} shape={row.project.shape} size={32} subCompanyId={row.project.subCompanyId} />
            <span className="min-w-0 flex-1">
              <bdi className="block truncate text-subheadline font-semibold text-ink">{projectName(row.project)}</bdi>
              <span className="block truncate text-footnote text-ink-2">{counted(t, 'dashboard.waitingForUs.items', row.count)}</span>
            </span>
          </Link>
        </li>
      ))}
    </AttentionCard>
  );
}
