import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { formatDay, formatNumber, todayISO } from '../../../lib/dates';
import { ProjectCover } from '../../projects/ProjectCard';

/** The project's facts in one quiet panel: the cover, the key facts, the next three deadlines and the team (redesign spec 3.4). */
export function AboutPanel({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const today = todayISO();
  const next = detail.deadlines.filter((deadline) => deadline.date >= today).slice(0, 3);
  const none = t('overview.none');
  const facts: [string, ReactNode][] = [
    [t('projectForm.location'), project.location || none],
    [t('projectForm.area'), project.areaM2 === null ? none : formatNumber(project.areaM2, lang)],
    [t('projectForm.startDate'), project.startDate ? formatDay(project.startDate, lang, 'long') : none],
    [t('projectForm.endDate'), project.targetEndDate ? formatDay(project.targetEndDate, lang, 'long') : none],
    [t('projectForm.modelFolder'), project.modelFolderPath ? <bdi dir="ltr" className="break-all text-footnote">{project.modelFolderPath}</bdi> : none],
  ];
  const heading = 'text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2';
  return (
    <section aria-labelledby="about-title" className="panel flex flex-col gap-5 p-5">
      <h2 id="about-title" className="text-section text-ink">{t('project.about')}</h2>
      {project.coverFileId && (
        <div className="-mt-1 overflow-hidden rounded-2xl">
          <ProjectCover summary={detail} className="aspect-video" />
        </div>
      )}
      <dl className="flex flex-col gap-2.5">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-footnote text-ink-2">{label}</dt>
            <dd dir="auto" className="tabular text-subheadline text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className={heading}>{t('overview.deadlines')}</h3>
        {next.length === 0 ? <p className="mt-2 text-footnote text-ink-2">{t('overview.noDeadlines')}</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {next.map((deadline) => (
              <li key={deadline.id} className="flex items-baseline justify-between gap-3 text-subheadline">
                <bdi className="min-w-0 truncate text-ink">{deadline.name}</bdi>
                <span className="tabular shrink-0 text-ink-2">{formatDay(deadline.date, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className={heading}>{t('overview.team')}</h3>
        <ul className="mt-1 flex flex-col">
          {detail.members.map((member) => (
            <li key={member.user.id} className="flex min-h-11 items-center gap-2.5">
              <Avatar user={member.user} size={28} />
              <bdi className="min-w-0 truncate text-subheadline text-ink">{member.user.name}</bdi>
              <span className="ms-auto shrink-0 text-footnote text-ink-2">{member.isLeader ? t('team.leader') : member.discipline}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
