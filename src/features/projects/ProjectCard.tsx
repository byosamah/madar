import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { useFileUrl } from '../../app/files';
import { useLang } from '../../app/lang';
import { tintOf } from '../../components/Avatar';
import { AvatarStack } from '../../components/AvatarStack';
import { HealthPill } from '../../components/HealthPill';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { StageRail } from '../../components/StageRail';
import { formatDay } from '../../lib/dates';
import { useCardMenu } from './cardMenu';
import { FeedLine } from './FeedLine';

/** The latest render at 16:9, or a tinted panel with the project code when there is no cover (spec 4.1). */
export function ProjectCover({ summary, className = 'aspect-video' }: { summary: ProjectSummary; className?: string }) {
  const { t } = useTranslation();
  const url = useFileUrl(summary.project.coverFileId);
  const label = t('projects.cover', { name: summary.project.name });
  if (url) return <img src={url} alt={label} className={`w-full object-cover ${className}`} />;
  return (
    <div role="img" aria-label={label} style={{ background: tintOf(summary.project.id) }} className={`grid w-full place-items-center ${className}`}>
      <span className="tabular text-title-2 font-bold text-white">{summary.project.code}</span>
    </div>
  );
}

/** "12 Oct · 5d". A deadline in the past shows in red (spec 4.1). */
export function NextDeadlineLabel({ deadline }: { deadline: ProjectSummary['nextDeadline'] }) {
  const { t } = useTranslation();
  const lang = useLang();
  if (!deadline) return <span className="text-footnote text-label-2">{t('projects.noDeadline')}</span>;
  const late = deadline.daysLeft < 0;
  const left = late
    ? t('time.daysLate', { n: -deadline.daysLeft })
    : deadline.daysLeft === 0 ? t('time.today') : t('time.daysLeft', { n: deadline.daysLeft });
  return (
    <p className={`min-w-0 truncate text-footnote ${late ? 'text-red-text' : 'text-label-2'}`}>
      <bdi className={`font-medium ${late ? '' : 'text-label'}`}>{deadline.name}</bdi>
      <span className="tabular"> · {formatDay(deadline.date, lang)} · {left}</span>
    </p>
  );
}

export function People({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('overview.team')} className="flex shrink-0 items-center gap-2">
      {!summary.leader && <span className="text-caption text-label-2">{t('projects.noLeader')}</span>}
      <AvatarStack leader={summary.leader} team={summary.team} />
    </div>
  );
}

export function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const { project } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  return (
    <article className="relative h-full" {...menu.handlers}>
      <Link to={`/projects/${project.id}`} className="pressable surface flex h-full flex-col overflow-hidden rounded-card">
        <ProjectCover summary={summary} />
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="tabular text-footnote font-semibold text-label-2">{project.code}</span>
            <HealthPill health={summary.health} status={project.status} setBy={summary.healthSetBy} />
          </div>
          <div className="min-w-0">
            <h2 dir="auto" className="line-clamp-2 text-headline">{project.name}</h2>
            {summary.client && <p dir="auto" className="truncate text-footnote text-label-2">{summary.client.name}</p>}
          </div>
          <StageRail stages={summary.stages} currentId={summary.currentStage.id} />
          <ul aria-label={t('projects.latest')} className="flex flex-col gap-1.5">
            {summary.latest.length > 0
              ? summary.latest.map((item) => <FeedLine key={item.id} item={item} />)
              : <li className="text-footnote text-label-2">{t('projects.noUpdates')}</li>}
          </ul>
          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
            <NextDeadlineLabel deadline={summary.nextDeadline} />
            <People summary={summary} />
          </div>
        </div>
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </article>
  );
}
