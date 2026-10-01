import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { StateWord } from '../../components/StateWord';
import { projectHue, stageProgress } from '../../lib/projectColor';
import { useCardMenu } from './cardMenu';
import { NextDeadlineLabel } from './ProjectCard';

/** The word a row shows only when there is something to say: Late, At risk, or the status of a project that is not active. */
export function ProjectStateWord({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  if (!summary.health) return <StateWord tone="quiet">{t(`status.${summary.project.status}`)}</StateWord>;
  if (summary.health.value === 'late') return <StateWord tone="late">{t('health.late')}</StateWord>;
  if (summary.health.value === 'at_risk') return <StateWord tone="attn">{t('health.at_risk')}</StateWord>;
  return null;
}

/** One project as one calm row: tile, name, stage, progress line, next deadline, and a state word only when needed (redesign spec 3.3). */
export function ProjectListRow({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const { project } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  const index = summary.stages.findIndex((stage) => stage.id === summary.currentStage.id);
  return (
    <li {...menu.handlers}>
      <Link
        to={`/projects/${project.id}`}
        className="pressable grid grid-cols-[34px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3.5 hover:bg-fill/50 md:grid-cols-[34px_minmax(0,1fr)_7.5rem_minmax(0,13rem)] md:gap-x-5"
      >
        <ProjectTile id={project.id} name={project.name} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span dir="auto" className="truncate text-[calc(15px*var(--boost))] font-semibold text-ink">{project.name}</span>
            <ProjectStateWord summary={summary} />
          </span>
          <span dir="auto" className="block truncate text-footnote text-ink-2">
            {summary.currentStage.name}
            {summary.client && <> · <bdi>{summary.client.name}</bdi></>}
          </span>
        </span>
        <ProgressLine
          value={stageProgress(summary)}
          hue={projectHue(project.id)}
          label={t('projects.stageCount', { n: index + 1, total: summary.stages.length })}
          className="col-start-2 md:col-start-auto"
        />
        <span className="col-start-2 min-w-0 md:col-start-auto md:text-end">
          <NextDeadlineLabel deadline={summary.nextDeadline} />
        </span>
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </li>
  );
}
