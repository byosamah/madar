import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { formatDay, formatNumber } from '../../../lib/dates';
import { ProjectCover } from '../../projects/ProjectCard';

/** The project's facts in one quiet panel: the cover, or the project's picture large, and the key facts (redesign spec 3.4). */
export function AboutPanel({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const none = t('overview.none');
  const facts: [string, ReactNode][] = [
    [t('projectForm.location'), project.location || none],
    [t('projectForm.area'), project.areaM2 === null ? none : formatNumber(project.areaM2, lang)],
    [t('projectForm.startDate'), project.startDate ? formatDay(project.startDate, lang, 'long') : none],
    [t('projectForm.endDate'), project.targetEndDate ? formatDay(project.targetEndDate, lang, 'long') : none],
    [t('projectForm.modelFolder'), project.modelFolderPath ? <bdi dir="ltr" className="break-all text-footnote">{project.modelFolderPath}</bdi> : none],
  ];
  return (
    <section aria-labelledby="about-title" className="panel flex flex-col gap-5 p-5">
      <h2 id="about-title" className="text-section text-ink">{t('project.about')}</h2>
      <div className="-mt-1 overflow-hidden rounded-2xl ring-1 ring-inset ring-ink/10">
        <ProjectCover summary={detail} className="aspect-video" />
      </div>
      <dl className="flex flex-col gap-2.5">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-footnote text-ink-2">{label}</dt>
            <dd dir="auto" className="tabular text-subheadline text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
