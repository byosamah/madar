import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { formatDay, formatNumber } from '../../../lib/dates';
import { parseProjectCode } from '../../../lib/projectCode';
import { ProjectCover } from '../../projects/ProjectCard';
import { ProjectLinks } from './ProjectLinks';

/** The project's facts in one quiet panel: the cover, or the project's picture large, and the key facts (redesign spec 3.4). */
export function AboutPanel({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const none = t('overview.none');
  const parts = parseProjectCode(project.code);
  // The full code, and for a new code its class in words (owner, 2026-10-05).
  const code = (
    <>
      <span dir="ltr" className="block break-all">{project.code}</span>
      {parts && <span className="block text-footnote text-ink-2">{t(`projectCode.classes.${parts.classification}`)}</span>}
    </>
  );
  const facts: [string, ReactNode][] = [
    [t('projectCode.group'), code],
    [t('projectForm.location'), project.location || none],
    [t('projectForm.area'), project.areaM2 === null ? none : formatNumber(project.areaM2, lang)],
    [t('projectForm.contractStartDate'), project.contractStartDate ? formatDay(project.contractStartDate, lang, 'long') : none],
    [t('projectForm.startDate'), project.startDate ? formatDay(project.startDate, lang, 'long') : none],
    [t('projectForm.endDate'), project.targetEndDate ? formatDay(project.targetEndDate, lang, 'long') : none],
  ];
  return (
    <section aria-labelledby="about-title" className="panel flex flex-col gap-5 p-5">
      <h2 id="about-title" className="text-section text-ink">{t('project.about')}</h2>
      <div className="-mt-1 overflow-hidden rounded-2xl ring-1 ring-inset ring-ink/10">
        <ProjectCover summary={detail} className="aspect-video" />
      </div>
      <ProjectLinks detail={detail} />
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
