import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { projectsListLink } from '../../app/lastList';
import type { ProjectDetail } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { ProjectCover } from '../projects/ProjectCard';
import { HealthControl } from './HealthControl';
import { ProjectActions } from './ProjectActions';
import { StageControl } from './StageControl';

/** The cover's shape in the project header. The loading cover uses the same shape, so the card grows into one place. */
export const HEADER_COVER = 'aspect-[5/2] sm:aspect-[3/1] lg:aspect-[4/1]';

/** Cover, code, name, client, health and stage rail. "Post update" is the one tinted action (spec 5.1). */
export function ProjectHeader({ detail, onPost }: { detail: ProjectDetail; onPost: () => void }) {
  const { t } = useTranslation();
  const { project } = detail;
  const viewOnly = !detail.viewerCan.post && !detail.viewerCan.edit;
  return (
    <header className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-card">
        <ProjectCover summary={detail} className={HEADER_COVER} layoutId={`cover-${detail.project.id}`} />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
          <Link
            to={projectsListLink()}
            className="glass-media pressable inline-flex min-h-11 items-center gap-1 rounded-full pe-4 ps-2 text-subheadline font-semibold">
            <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden />
            {t('project.back')}
          </Link>
          <ProjectActions detail={detail} />
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-footnote font-semibold text-label-2">{project.code}</span>
            <HealthControl detail={detail} />
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold text-label-2">{t('project.viewOnly')}</span>}
          </div>
          <h1 dir="auto" className="text-large-title [text-wrap:balance]">{project.name}</h1>
          {detail.client && <p dir="auto" className="text-subheadline text-label-2">{detail.client.name}</p>}
        </div>
        {detail.viewerCan.post && <Button variant="primary" onClick={onPost}>{t('projects.postUpdate')}</Button>}
      </div>
      <StageControl detail={detail} />
    </header>
  );
}
