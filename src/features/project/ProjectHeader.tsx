import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { MessageCircleIcon } from '../../components/icons/animated/message-circle';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { projectsListLink } from '../../app/lastList';
import { useIsPhone } from '../../app/useIsPhone';
import type { ProjectDetail } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { HiddenMark } from '../../components/HiddenMark';
import { ProjectTile } from '../../components/ProjectTile';
import { spring } from '../../design/motion';
import { NextDeadlineLabel } from '../projects/ProjectCard';
import { HealthControl } from './HealthControl';
import { phoneMainButton } from './mainButton';
import { useHasPostDraft } from './overview/postDraft';
import { ProjectActions, ProjectSheets, type ProjectSheetName } from './ProjectActions';
import { StageControl } from './StageControl';
import { StageProgress } from './StageProgress';
import type { ProjectTab } from './tabs';
import { clientName } from '../../lib/clientName';
import { isHiddenProject, isInternalProject, shownCode, shownName } from '../../lib/projectLabel';
import { currentStageIndex } from '../../lib/stageFlow';
import { useLang } from '../../app/lang';

/** The tile and the name alone, drawn at once while the project loads, so the tapped row grows into them (motion moment 1). */
export function HeaderShell({ id, name, mark, shape }: { id: string; name: string; mark?: number; shape?: string | null }) {
  return (
    <div className="flex items-start gap-4 pt-14">
      <ProjectTile id={id} mark={mark} shape={shape} size={48} shared />
      <p dir="auto" className="text-page-title text-ink">
        <motion.span layoutId={`name-${id}`} transition={spring.expand} className="inline-block">{name}</motion.span>
      </p>
    </div>
  );
}

/** True when the person holds no switch that changes this project: the tag "View only" then shows (role rights version 2). */
export function isViewOnly(can: ProjectDetail['viewerCan']): boolean {
  return !(can.postUpdate || can.comment || can.editDetails || can.editTeam || can.editStages || can.editDeadlines || can.applyTemplate
    || can.links || can.upload || can.deliver || can.logTracker || can.addTask || can.planMeeting || can.archive || can.changeLeader || can.healthOverride);
}

/**
 * What the header keeps for its controls. The header owns the open choices, so a phone turned to a wide screen swaps the layout
 * without closing the sheet that a person works in (phone D).
 */
type Controls = {
  onSheet: (sheet: ProjectSheetName) => void;
  stage: boolean; onStage: (open: boolean) => void;
  health: boolean; onHealth: (open: boolean) => void;
};

/** The chat button and the opener it sends: Back from the chat returns to this screen (phone D, lead amendment 6). */
function ChatLink({ chatId, className }: { chatId: string; className: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <Link to={`/inbox/${chatId}`} state={{ from: location.pathname + location.search }} className={className}>
      <AnimatedIcon icon={MessageCircleIcon} size={18} aria-hidden />
      {t('project.chat')}
    </Link>
  );
}

/**
 * The header of a phone (phone D, P5): the identity row, the stage row with the health sign, a full width stage line, and the action
 * row. The deadline label leaves the header: Overview shows it. The navy goes to one button for each tab (`phoneMainButton`).
 */
function PhoneHeader({ detail, onPost, tab, controls }: { detail: ProjectDetail; onPost: () => void; tab: ProjectTab; controls: Controls }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  // Only "has text" is read, so a key typed in the update box does not render the whole header again.
  const hasDraft = useHasPostDraft(project.id);
  const main = phoneMainButton(tab, detail.viewerCan, hasDraft);
  const viewOnly = isViewOnly(detail.viewerCan);
  const index = currentStageIndex(detail.stages, detail.currentStage);
  const count = t('projects.stageCount', { n: index + 1, total: detail.stages.length });
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <ProjectTile id={project.id} mark={project.mark} shape={project.shape} size={48} subCompanyId={detail.subCompanyId} shared />
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="text-page-title text-ink [text-wrap:balance]">
            <motion.span layoutId={`name-${project.id}`} transition={spring.expand} className="inline-block">{shownName(project, lang)}</motion.span>
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-subheadline text-ink-2">
            <span dir="ltr" className="tabular break-all">{project.code}</span>
            {detail.client && <><span aria-hidden>·</span><bdi>{clientName(detail.client, lang)}</bdi></>}
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold text-ink-2">{t('project.viewOnly')}</span>}
          </p>
        </div>
        <ProjectActions detail={detail} onSheet={controls.onSheet} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StageControl detail={detail} open={controls.stage} onOpenChange={controls.onStage} />
        <span className="text-footnote text-ink-2">{count}</span>
        <span className="ms-auto"><HealthControl detail={detail} open={controls.health} onOpenChange={controls.onHealth} /></span>
      </div>
      <StageProgress detail={detail} size="md" className="w-full" />
      {(detail.viewerCan.postUpdate || detail.chatId) && (
        <div data-action-row className="flex gap-2">
          {detail.viewerCan.postUpdate && (
            <Button variant={main === 'post' ? 'primary' : 'secondary'} className="flex-1" onClick={onPost}>{t('projects.postUpdate')}</Button>
          )}
          {detail.chatId && (
            <ChatLink
              chatId={detail.chatId}
              className="pressable inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-fill px-4 text-subheadline font-semibold text-ink hover:bg-fill-strong"
            />
          )}
        </div>
      )}
    </header>
  );
}

/** The header of a desk (redesign spec 3.4): back, tile, name, client, one stage line, one main button and the "…" menu. */
function DeskHeader({ detail, onPost, controls }: { detail: ProjectDetail; onPost: () => void; controls: Controls }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const viewOnly = isViewOnly(detail.viewerCan);
  return (
    <header className="flex flex-col gap-3">
      <Link to={projectsListLink()} className="pressable -ms-2 inline-flex min-h-11 items-center gap-0.5 self-start rounded-full pe-3 ps-1 text-subheadline font-semibold text-link max-sm:hidden">
        <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
        {t('project.back')}
      </Link>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <ProjectTile id={project.id} mark={project.mark} shape={project.shape} size={48} subCompanyId={detail.subCompanyId} shared />
        <div className="min-w-0 flex-1 basis-60">
          <h1 dir="auto" className="text-page-title text-ink [text-wrap:balance]">
            <motion.span layoutId={`name-${project.id}`} transition={spring.expand} className="inline-block">{shownName(project, lang)}</motion.span>
            {isHiddenProject(project) && <HiddenMark size={18} className="ms-2" />}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-subheadline text-ink-2">
            {/* An internal project shows the word Internal in place of its code (fbk_044). */}
            <span dir={isInternalProject(project) ? 'auto' : 'ltr'} className="tabular break-all">{shownCode(project, t)}</span>
            {detail.client && <><span aria-hidden>·</span><bdi>{clientName(detail.client, lang)}</bdi></>}
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold text-ink-2">{t('project.viewOnly')}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail.viewerCan.postUpdate && <Button variant="primary" onClick={onPost}>{t('projects.postUpdate')}</Button>}
          {/* The project chat, for the people who may open it (chat design 2026-10-19, item 18). A grey button, never the main one. */}
          {detail.chatId && (
            <ChatLink chatId={detail.chatId} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-fill px-4 text-subheadline font-semibold text-ink hover:bg-fill-strong" />
          )}
          <ProjectActions detail={detail} onSheet={controls.onSheet} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StageControl detail={detail} open={controls.stage} onOpenChange={controls.onStage} />
        <StageProgress detail={detail} className="w-28 sm:w-36" />
        <NextDeadlineLabel deadline={detail.nextDeadline} stageEnd={detail.stageEnd} continuous={detail.project.continuous} />
        <HealthControl detail={detail} open={controls.health} onOpenChange={controls.onHealth} />
      </div>
    </header>
  );
}

/** The calm header: the phone layout under 640 px, the desk layout from there. The sheets of the "…" menu stay mounted across the swap. */
export function ProjectHeader({ detail, onPost, tab }: { detail: ProjectDetail; onPost: () => void; tab: ProjectTab }) {
  const phone = useIsPhone();
  const [sheet, setSheet] = useState<ProjectSheetName>(null);
  const [stage, setStage] = useState(false);
  const [health, setHealth] = useState(false);
  const controls: Controls = { onSheet: setSheet, stage, onStage: setStage, health, onHealth: setHealth };
  return (
    <>
      {phone ? <PhoneHeader detail={detail} onPost={onPost} tab={tab} controls={controls} /> : <DeskHeader detail={detail} onPost={onPost} controls={controls} />}
      <ProjectSheets detail={detail} sheet={sheet} onSheet={setSheet} />
    </>
  );
}
