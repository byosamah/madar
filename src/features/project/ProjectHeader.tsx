import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { projectsListLink } from '../../app/lastList';
import type { ProjectDetail } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { projectHue, stageProgress } from '../../lib/projectColor';
import { NextDeadlineLabel } from '../projects/ProjectCard';
import { HealthControl } from './HealthControl';
import { ProjectActions } from './ProjectActions';
import { StageControl } from './StageControl';

/** The calm header (redesign spec 3.4): back, tile, name, client, one stage line, one main button and the "…" menu. */
export function ProjectHeader({ detail, onPost }: { detail: ProjectDetail; onPost: () => void }) {
  const { t } = useTranslation();
  const { project } = detail;
  const viewOnly = !detail.viewerCan.post && !detail.viewerCan.edit;
  const index = detail.stages.findIndex((stage) => stage.id === detail.currentStage.id);
  return (
    <header className="flex flex-col gap-3">
      <Link to={projectsListLink()} className="pressable -ms-2 inline-flex min-h-11 items-center gap-0.5 self-start rounded-full pe-3 ps-1 text-subheadline font-semibold text-link">
        <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden />
        {t('project.back')}
      </Link>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <ProjectTile id={project.id} name={project.name} size={48} />
        <div className="min-w-0 flex-1 basis-60">
          <h1 dir="auto" className="text-page-title text-ink [text-wrap:balance]">{project.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-subheadline text-ink-2">
            <span className="tabular">{project.code}</span>
            {detail.client && <><span aria-hidden>·</span><bdi>{detail.client.name}</bdi></>}
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold text-ink-2">{t('project.viewOnly')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {detail.viewerCan.post && <Button variant="primary" onClick={onPost}>{t('projects.postUpdate')}</Button>}
          <ProjectActions detail={detail} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StageControl detail={detail} />
        <ProgressLine
          value={stageProgress(detail)}
          hue={projectHue(project.id)}
          label={t('projects.stageCount', { n: index + 1, total: detail.stages.length })}
          className="w-28 sm:w-36"
        />
        <NextDeadlineLabel deadline={detail.nextDeadline} />
        <HealthControl detail={detail} />
      </div>
    </header>
  );
}
