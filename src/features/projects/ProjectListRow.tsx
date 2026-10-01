import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { StatusSign, signOfStatus } from '../../components/StatusSign';
import { spring } from '../../design/motion';
import { projectHue } from '../../lib/projectColor';
import { setSharedSource } from '../../app/sharedLayout';
import { useCardMenu } from './cardMenu';
import { NextDeadlineLabel } from './ProjectCard';

/** The word a row shows only when there is something to say: Late, At risk, or the status of a project that is not active. */
export function ProjectStateWord({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  if (!summary.health) return <StatusSign state={signOfStatus(summary.project.status)}>{t(`status.${summary.project.status}`)}</StatusSign>;
  if (summary.health.value === 'late') return <StatusSign state="late">{t('health.late')}</StatusSign>;
  if (summary.health.value === 'at_risk') return <StatusSign state="at_risk">{t('health.at_risk')}</StatusSign>;
  return null;
}

/** One project as one calm row: tile, name, stage, progress line, next deadline, and a state word only when needed (redesign spec 3.3). */
export function ProjectListRow({ summary, source }: { summary: ProjectSummary; source: 'home' | 'projects' }) {
  const { t } = useTranslation();
  const { project } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  const index = summary.stages.findIndex((stage) => stage.id === summary.currentStage.id);
  return (
    <motion.li
      {...menu.handlers}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ...spring.standard, duration: 0.46 }}
    >
      <Link
        to={`/projects/${project.id}`}
        onClick={() => setSharedSource(source)}
        className="pressable grid grid-cols-[34px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3.5 hover:bg-fill/50 @xl:grid-cols-[34px_minmax(0,1fr)_minmax(0,14rem)] @xl:gap-x-4 @4xl:grid-cols-[34px_minmax(0,1fr)_8rem_minmax(0,14rem)] @4xl:gap-x-6"
      >
        <ProjectTile id={project.id} mark={project.mark} shared />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <motion.span layoutId={`name-${project.id}`} transition={spring.expand} dir="auto" className="truncate text-[calc(15px*var(--boost))] font-semibold text-ink">{project.name}</motion.span>
            <ProjectStateWord summary={summary} />
          </span>
          <span dir="auto" className="block truncate text-footnote text-ink-2">
            {summary.currentStage.name}
            {summary.client && <> · <bdi>{summary.client.name}</bdi></>}
          </span>
        </span>
        {/* The row follows its own width: line and deadline under the name, then in one end column, then in two (redesign spec 3.3). */}
        <span className="col-start-2 flex min-w-0 flex-col gap-1.5 @xl:col-start-auto @xl:items-end @4xl:contents">
          <ProgressLine
            index={index}
            total={summary.stages.length}
            complete={project.status === 'completed'}
            hue={projectHue(project.id)}
            label={t('projects.stageCount', { n: index + 1, total: summary.stages.length })}
            className="w-full max-w-48 @xl:w-32 @4xl:w-full"
          />
          <span className="min-w-0 max-w-full @xl:text-end">
            <NextDeadlineLabel deadline={summary.nextDeadline} />
          </span>
        </span>
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </motion.li>
  );
}
