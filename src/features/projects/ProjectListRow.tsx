import { AnimatePresence, motion } from 'motion/react';
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
 * The stage column of a row or a box: the stage name with its steps. A continuous project has no current stage, so it says
 * "Continuous, N open" and draws no steps (fbk_084, owner 2026-11-08). One part for both, so the first load keeps one copy.
 */
function StageLine({ summary, className }: { summary: ProjectSummary; className: string }) {
  const { t } = useTranslation();
  const { currentStage, stages, project } = summary;
  const index = stages.findIndex((stage) => stage.id === currentStage.id);
  return (
    <>
      <bdi dir="auto" className="truncate text-footnote font-medium text-ink">{project.continuous ? t('projects.continuousOpen', { count: summary.openTasks }) : currentStage.name}</bdi>
      {!project.continuous && (
        <ProgressLine
          index={index}
          total={stages.length}
          complete={project.status === 'completed'}
          glow={false}
          tone={signOfProject(summary)}
          label={t('projects.stageCount', { n: index + 1, total: stages.length })}
          className={className}
        />
      )}
    </>
  );
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
        <ProjectTile id={project.id} mark={project.mark} shape={project.shape} subCompanyId={summary.subCompanyId} shared />
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
            <StageLine summary={summary} className="w-full max-w-48 @4xl:max-w-none" />
          </span>
          {/* The team as pictures only, the leader first, bigger and with a ring (colleague's comment 2; 34 px and the ink ring, owner 2026-10-26, fbk_060). The row shows three pictures at most, then "+N" (owner, 2026-10-18). With a leader, the stack shows two team members after the leader. Beside the deadline until the row is wide. */}
          <span className="flex min-w-0 items-center justify-between gap-3 @4xl:contents">
            <span data-team-column className="order-last @4xl:order-none">
              <AvatarStack leader={summary.leader} team={summary.team} max={summary.leader ? 2 : 3} size={26} leaderSize={32} />
            </span>
            <span className="min-w-0 max-w-full @4xl:text-end">
              <NextDeadlineLabel deadline={summary.nextDeadline} stageEnd={summary.stageEnd} continuous={summary.project.continuous} />
            </span>
          </span>
        </span>
      </Link>
      <RowMenu summary={summary} point={menu.point} onClose={menu.close} />
    </motion.li>
  );
});

/*
 * The box of fbk_080 (ProjectBox, ProjectBoxGrid) lives in this file on purpose. As a module of its own, imported by Home, it made the
 * remote build split five shared modules out of the entry chunk (ProjectTile, due, files, projectName, projectShape): the first load
 * went from 32 to 37 files and over its byte limit (check-bundles). `ProjectBox.tsx` re-exports both names, so every caller imports them from there.
 */
/**
 * One project as one box (fbk_080, owner 2026-11-05, option B "tile boxes"). It holds what a row holds, in one column: the tile and the
 * state word on top, the name and the client, then at the bottom the stage with its steps, and the next deadline with the team.
 * The rules of the row apply: one link, `projects.get` starts on pointerdown and never on hover, the menu is the `RowMenu` part (no router
 * hook in this body), and the box is memoized, so a list that reloads for one project renders only that box.
 */
export const ProjectBox = memo(function ProjectBox({ summary, source }: { summary: ProjectSummary; source: 'home' | 'projects' }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = summary;
  const menu = useContextMenu();
  const prefetch = usePrefetchCall();
  return (
    <motion.li
      {...menu.handlers}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ...spring.standard, duration: 0.46 }}
      className="min-w-0"
    >
      <Link
        to={`/projects/${project.id}`}
        data-project-box
        onClick={() => setSharedSource(source)}
        onPointerDown={() => prefetch('projects.get', { id: project.id })}
        className="pressable panel flex h-full min-w-0 flex-col gap-3 p-4 transition-colors hover:!bg-fill/50"
      >
        <span className="flex items-start justify-between gap-2">
          <ProjectTile id={project.id} mark={project.mark} shape={project.shape} subCompanyId={summary.subCompanyId} size={40} shared />
          <span className="flex min-h-6 min-w-0 items-center gap-2">
            <ProjectStateWord summary={summary} />
            {isHiddenProject(project) && <HiddenMark />}
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <motion.span layoutId={`name-${project.id}`} transition={spring.expand} dir="auto" className="line-clamp-2 text-[calc(15px*var(--boost))] font-semibold leading-snug text-ink">
            {shownName(project, lang)}
          </motion.span>
          {summary.client && <bdi dir="auto" className="block truncate text-footnote text-ink-2">{clientName(summary.client, lang)}</bdi>}
          {!summary.client && isInternalProject(project) && <span className="block truncate text-footnote text-ink-2">{t('project.internal')}</span>}
        </span>
        <span data-stage-column className="mt-auto flex min-w-0 flex-col gap-1.5">
          <StageLine summary={summary} className="w-full" />
        </span>
        {/* The deadline and the team share one row. A narrow box wraps them, the deadline first. */}
        <span data-box-last className="flex min-h-7 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="min-w-0 max-w-full">
            <NextDeadlineLabel deadline={summary.nextDeadline} stageEnd={summary.stageEnd} continuous={summary.project.continuous} wrap />
          </span>
          <span data-team-column>
            <AvatarStack leader={summary.leader} team={summary.team} max={summary.leader ? 2 : 3} size={22} leaderSize={28} />
          </span>
        </span>
      </Link>
      <RowMenu summary={summary} point={menu.point} onClose={menu.close} />
    </motion.li>
  );
});

/** A grid of project boxes: 2 columns on a phone, as many 236 px columns as fit on a desk. The caller sets the `LayoutGroup`. */
export function ProjectBoxGrid({ label, rows, source }: { label: string; rows: ProjectSummary[]; source: 'home' | 'projects' }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(236px,1fr))]">
      <AnimatePresence initial={false}>
        {rows.map((summary) => <ProjectBox key={summary.project.id} summary={summary} source={source} />)}
      </AnimatePresence>
    </ul>
  );
}
