import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { usePersonName } from '../../app/personName';
import { ProjectTile } from '../../components/ProjectTile';
import { StatusSign } from '../../components/StatusSign';
import { isHiddenProject, shownKey } from '../../lib/projectLabel';
import { HiddenMark } from '../../components/HiddenMark';
import { useProjectName } from '../../app/projectName';

/**
 * The card of one pin on the Dashboard map (owner, 2026-10-18, fbk_017). It shows the tile with its sub-company badge, the name,
 * the code, the stage, the leader, the health sign and the way to the project. The stage and leader lines reuse the words of the
 * meeting view. The health shows as the status shape with its word, and only for At risk and Late: On track shows nothing, as in
 * every list of Madar (audit 2026-10-19, PRJ-14). "panel" is the card on the map; "plain" sits inside a sheet, which is a panel already.
 */
export function MapPinCard({ summary, variant = 'panel' }: { summary: ProjectSummary; variant?: 'panel' | 'plain' }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const nameOf = usePersonName();
  const { project, currentStage, leader, health } = summary;
  const sign = health && health.value !== 'on_track' ? health.value : null;
  return (
    <section aria-label={projectName(project)} className={`flex flex-col gap-4 ${variant === 'panel' ? 'panel w-72 max-w-[calc(100vw-3rem)] p-4 shadow-xl' : ''}`}>
      <div className="flex items-start gap-3">
        <ProjectTile id={project.id} mark={project.mark} size={34} subCompanyId={summary.subCompanyId} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2"><bdi dir="auto" className="break-words text-headline text-ink">{projectName(project)}</bdi>{isHiddenProject(project) && <HiddenMark />}</span>
          <span dir="ltr" className="tabular text-footnote text-ink-2 [text-align:start]">{shownKey(project, t)}</span>
          <span dir="auto" className="text-footnote text-ink-2">{t('map.card.stage', { name: currentStage.name })}</span>
          {leader && <span dir="auto" className="text-footnote text-ink-2">{t('dashboard.meeting.leader', { name: nameOf(leader) })}</span>}
          {sign && <span className="pt-1"><StatusSign state={sign}>{t(`health.${sign}`)}</StatusSign></span>}
        </div>
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
