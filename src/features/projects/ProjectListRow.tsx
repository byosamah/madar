import { motion } from 'motion/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { AvatarStack } from '../../components/AvatarStack';
import { HiddenMark } from '../../components/HiddenMark';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { ProjectSign } from '../../components/ProjectSign';
import { signOfProject, StatusSign } from '../../components/StatusSign';
import { spring } from '../../design/motion';
import { setSharedSource } from '../../app/sharedLayout';
import { usePrefetchCall } from '../../app/prefetch';
import { useCardMenu } from './cardMenu';
import { NextDeadlineLabel } from './ProjectCard';
import { clientName } from '../../lib/clientName';
import { isHiddenProject, isInternalProject, shownName } from '../../lib/projectLabel';
import { useLang } from '../../app/lang';
import { useProjectName } from '../../app/projectName';

/** The word a row shows only when there is something to say: Late, At risk, or the status of a project that is not active. */
export function ProjectStateWord({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  if (!summary.health) return <ProjectSign project={summary.project} staleDays={summary.staleDays} />;
  if (summary.health.value === 'late') return <StatusSign state="late">{t('health.late')}</StatusSign>;
  if (summary.health.value === 'at_risk') return <StatusSign state="at_risk">{t('health.at_risk')}</StatusSign>;
  return null;
}

/**
 * The context menu of one row. Its items read the router (useCardMenu calls useHref), so this part renders again on each link
 * change. The row around it does not, also when a task panel opens over the list (performance audit 2026-10-07, RND-M1).
 */
function RowMenu({ summary, point, onClose }: { summary: ProjectSummary; point: { x: number; y: number } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const items = useCardMenu(summary);
  return <ContextMenu label={t('projects.menu', { name: projectName(summary.project) })} items={items} point={point} onClose={onClose} />;
}

/**
 * One project as one calm row: picture, name and client, the stage column (name and steps), the next deadline, and a sign only when needed.
 * The row is memoized (performance audit 2026-10-21, RN-6): a list that reloads for one changed project renders only that row. The row reads
 * no clock (the days left come with the summary), and the summary keeps its object when its data is equal.
 */
export const ProjectListRow = memo(function ProjectListRow({ summary, source }: { summary: ProjectSummary; source: 'home' | 'projects' }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = summary;
  const menu = useContextMenu();
  const prefetch = usePrefetchCall();
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
        // A press starts the read of the project page before the click lands. Not on hover: one project at a time, and only
        // the one the person opens (performance audit 2026-10-07, FET-12). The prototype asks nothing here.
        onPointerDown={() => prefetch('projects.get', { id: project.id })}
        className="pressable grid grid-cols-[34px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3.5 hover:bg-fill/50 @xl:grid-cols-[34px_minmax(0,1fr)_minmax(0,18rem)] @xl:gap-x-4 @4xl:grid-cols-[34px_minmax(0,1fr)_minmax(0,13rem)_7rem_minmax(0,14rem)] @4xl:gap-x-8"
      >
        <ProjectTile id={project.id} mark={project.mark} subCompanyId={summary.subCompanyId} shared />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <motion.span layoutId={`name-${project.id}`} transition={spring.expand} dir="auto" className="truncate text-[calc(15px*var(--boost))] font-semibold text-ink">{shownName(project, lang)}</motion.span>
            {isHiddenProject(project) && <HiddenMark />}
            <ProjectStateWord summary={summary} />
          </span>
          {/* An internal project has no client: the word Internal stands where a code or a client shows (fbk_044). */}
          {summary.client && <bdi dir="auto" className="block truncate text-footnote text-ink-2">{clientName(summary.client, lang)}</bdi>}
          {!summary.client && isInternalProject(project) && <span className="block truncate text-footnote text-ink-2">{t('project.internal')}</span>}
        </span>
        {/* The row follows its own width: stage and deadline under the name, then in one end column, then in two.
            The stage is a column of its own: its name with the stage steps under it (colleague's comment 1, 2026-10-01). */}
        <span className="col-start-2 flex min-w-0 flex-col gap-2 @xl:col-start-auto @4xl:contents">
          <span data-stage-column className="flex min-w-0 flex-col gap-1.5">
            <bdi dir="auto" className="truncate text-footnote font-medium text-ink">{summary.currentStage.name}</bdi>
            <ProgressLine
              index={index}
              total={summary.stages.length}
              complete={project.status === 'completed'}
              glow={false}
              tone={signOfProject(summary)}
              label={t('projects.stageCount', { n: index + 1, total: summary.stages.length })}
              className="w-full max-w-48 @4xl:max-w-none"
            />
          </span>
          {/* The team as pictures only, the leader first, bigger and with a ring (colleague's comment 2; 34 px and the ink ring, owner 2026-10-26, fbk_060). The row shows three pictures at most, then "+N" (owner, 2026-10-18). With a leader, the stack shows two team members after the leader. Beside the deadline until the row is wide. */}
          <span className="flex min-w-0 items-center justify-between gap-3 @4xl:contents">
            <span data-team-column className="order-last @4xl:order-none">
              <AvatarStack leader={summary.leader} team={summary.team} max={summary.leader ? 2 : 3} size={26} leaderSize={32} />
            </span>
            <span className="min-w-0 max-w-full @4xl:text-end">
              <NextDeadlineLabel deadline={summary.nextDeadline} stageEnd={summary.stageEnd} />
            </span>
          </span>
        </span>
      </Link>
      <RowMenu summary={summary} point={menu.point} onClose={menu.close} />
    </motion.li>
  );
});
