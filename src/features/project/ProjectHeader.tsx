import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { MessageCircleIcon } from '../../components/icons/animated/message-circle';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { projectsListLink } from '../../app/lastList';
import type { ProjectDetail } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { signOfProject } from '../../components/StatusSign';
import { spring } from '../../design/motion';
import { NextDeadlineLabel } from '../projects/ProjectCard';
import { HealthControl } from './HealthControl';
import { ProjectActions } from './ProjectActions';
import { StageControl } from './StageControl';
import { clientName } from '../../lib/clientName';
import { useLang } from '../../app/lang';

/** The tile and the name alone, drawn at once while the project loads, so the tapped row grows into them (motion moment 1). */
export function HeaderShell({ id, name, mark }: { id: string; name: string; mark?: number }) {
  return (
    <div className="flex items-start gap-4 pt-14">
      <ProjectTile id={id} mark={mark} size={48} shared />
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

/** The calm header (redesign spec 3.4): back, tile, name, client, one stage line, one main button and the "…" menu. */
export function ProjectHeader({ detail, onPost }: { detail: ProjectDetail; onPost: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const viewOnly = isViewOnly(detail.viewerCan);
  const index = detail.stages.findIndex((stage) => stage.id === detail.currentStage.id);
  return (
    <header className="flex flex-col gap-3">
      <Link to={projectsListLink()} className="pressable -ms-2 inline-flex min-h-11 items-center gap-0.5 self-start rounded-full pe-3 ps-1 text-subheadline font-semibold text-link max-sm:hidden">
        <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
        {t('project.back')}
      </Link>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <ProjectTile id={project.id} mark={project.mark} size={48} subCompanyId={detail.subCompanyId} shared />
        <div className="min-w-0 flex-1 basis-60">
          <h1 dir="auto" className="text-page-title text-ink [text-wrap:balance]">
            <motion.span layoutId={`name-${project.id}`} transition={spring.expand} className="inline-block">{project.name}</motion.span>
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-subheadline text-ink-2">
            <span dir="ltr" className="tabular break-all">{project.code}</span>
            {detail.client && <><span aria-hidden>·</span><bdi>{clientName(detail.client, lang)}</bdi></>}
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold text-ink-2">{t('project.viewOnly')}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail.viewerCan.postUpdate && <Button variant="primary" onClick={onPost}>{t('projects.postUpdate')}</Button>}
          {/* The project chat, for the people who may open it (chat design 2026-10-19, item 18). A grey button, never the main one. */}
          {detail.chatId && (
            <Link to={`/inbox/${detail.chatId}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-fill px-4 text-subheadline font-semibold text-ink hover:bg-fill-strong">
              <AnimatedIcon icon={MessageCircleIcon} size={18} aria-hidden />
              {t('project.chat')}
            </Link>
          )}
          <ProjectActions detail={detail} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StageControl detail={detail} />
        <ProgressLine
          index={index}
          total={detail.stages.length}
          complete={project.status === 'completed'}
          tone={signOfProject(detail)}
          label={t('projects.stageCount', { n: index + 1, total: detail.stages.length })}
          className="w-28 sm:w-36"
        />
        <NextDeadlineLabel deadline={detail.nextDeadline} stageEnd={detail.stageEnd} />
        <HealthControl detail={detail} />
      </div>
    </header>
  );
}
