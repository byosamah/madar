import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { usePersonName } from '../../app/personName';
import { ProjectTile } from '../../components/ProjectTile';
import { projectKey } from '../../lib/projectCode';

/**
 * The card of one pin on the Dashboard map (owner, 2026-10-18, fbk_017): the tile, the name, the code, the stage, the leader,
 * the health word and the way to the project. The stage and leader lines reuse the words of the meeting view.
 */
export function MapPinCard({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const { project, currentStage, leader, health } = summary;
  return (
    <section aria-label={project.name} className="panel flex flex-wrap items-center gap-4 p-5">
      <ProjectTile id={project.id} mark={project.mark} size={34} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <bdi dir="auto" className="break-words text-headline text-ink">{project.name}</bdi>
        <span dir="ltr" className="tabular text-footnote text-ink-2">{projectKey(project.code)}</span>
        <span dir="auto" className="text-footnote text-ink-2">{t('map.card.stage', { name: currentStage.name })}</span>
        {leader && <span dir="auto" className="text-footnote text-ink-2">{t('dashboard.meeting.leader', { name: nameOf(leader) })}</span>}
        {health && <span className="text-footnote font-semibold text-ink">{t(`health.${health.value}`)}</span>}
      </div>
      <Link
        to={`/projects/${project.id}`}
        className="pressable inline-flex min-h-11 items-center justify-center rounded-full bg-fill px-5 text-subheadline font-semibold text-ink hover:bg-fill-strong"
      >
        {t('dashboard.meeting.openProject')}
      </Link>
    </section>
  );
}
