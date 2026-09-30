import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { HealthPill } from '../../components/HealthPill';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { StageRail } from '../../components/StageRail';
import { useCardMenu } from './cardMenu';
import { NextDeadlineLabel, People } from './ProjectCard';

/** The compact list: one row per project, the same data as the card without the cover (spec 4.3). */
export function ProjectRow({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const { project } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  return (
    <li {...menu.handlers}>
      <Link to={`/projects/${project.id}`} className="pressable surface flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card p-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-2">
            <span className="tabular text-footnote font-semibold text-label-2">{project.code}</span>
            <HealthPill health={summary.health} status={project.status} setBy={summary.healthSetBy} />
          </div>
          <p dir="auto" className="truncate text-headline">{project.name}</p>
          {summary.client && <p dir="auto" className="truncate text-footnote text-label-2">{summary.client.name}</p>}
        </div>
        <div className="min-w-0 basis-56"><StageRail stages={summary.stages} currentId={summary.currentStage.id} /></div>
        <div className="min-w-0 basis-48"><NextDeadlineLabel deadline={summary.nextDeadline} /></div>
        <People summary={summary} />
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </li>
  );
}
