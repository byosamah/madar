import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useSubCompany } from '../../../app/subCompanies';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { SubCompanyLogo } from '../../../components/SubCompanyLogo';
import { formatDay, formatNumber } from '../../../lib/dates';
import { googleMapsUrl } from '../../../lib/geo';
import { parseProjectCode } from '../../../lib/projectCode';
import { isInternalProject } from '../../../lib/projectLabel';
import { ProjectPlace } from './ProjectPlace';

/**
 * The project's facts in one quiet panel: the map of its pin (no cover picture, owner 2026-10-19), and the key facts (redesign spec 3.4).
 * The links of the project are not here: they sit in the Files & Links tab (owner, 2026-10-19).
 */
export function AboutPanel({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const none = t('overview.none');
  const subCompany = useSubCompany(project.subCompanyId);
  const parts = parseProjectCode(project.code);
  // The template the project came from (ADM-05): the team reads that a template update may change the tasks. The list is asked only
  // for a project that follows a template.
  const templates = useCall('projectTemplates.list', {}, { enabled: detail.templateId !== null });
  const templateName = templates.data?.find((template) => template.id === detail.templateId)?.name;
  // The full code, and for a new code its class in words (owner, 2026-10-05).
  const code = (
    <>
      <span dir="ltr" className="block break-all">{project.code}</span>
      {parts && <span className="block text-footnote text-ink-2">{t(`projectCode.classes.${parts.classification}`)}</span>}
    </>
  );
  // The sub-company with its logo (fbk_007). The logo is decoration: the name in text is the one label.
  const subCompanyLine = subCompany && (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true"><SubCompanyLogo subCompanyId={subCompany.id} size={24} /></span>
      <bdi dir="auto">{lang === 'ar' ? subCompany.nameAr : subCompany.name}</bdi>
    </span>
  );
  // The Location is the address of the pin, then one tap to directions (audit 2026-10-19, PRJ-04; owner, 2026-10-19). A pin with no
  // address shows the link alone. A project with no pin shows its old typed text, else "Not set".
  const locationLine = (
    <>
      {(project.location || !detail.geo) && <span className="block">{project.location || none}</span>}
      {detail.geo && (
        <a
          href={googleMapsUrl(detail.geo)}
          target="_blank"
          rel="noopener noreferrer"
          className="pressable -my-1.5 inline-flex min-h-11 items-center text-link underline underline-offset-2"
        >
          {t('map.pin.open')}
        </a>
      )}
    </>
  );
  // An internal project has no code on the screens, no place, no area and no contract date (fbk_044). It keeps its start and end.
  const internal = isInternalProject(project);
  const clientFacts: [string, ReactNode][] = internal ? [] : [
    [t('projectCode.group'), code],
    [t('projectForm.location'), locationLine],
    [t('projectForm.area'), project.areaM2 === null ? none : formatNumber(project.areaM2, lang)],
    [t('projectForm.contractStartDate'), project.contractStartDate ? formatDay(project.contractStartDate, lang, 'long') : none],
  ];
  const facts: [string, ReactNode][] = [
    ...clientFacts.slice(0, 1),
    ...(subCompanyLine ? [[t('subCompanies.label'), subCompanyLine] as [string, ReactNode]] : []),
    ...(templateName ? [[t('projectTemplates.aboutLabel'), <bdi key="template" dir="auto">{templateName}</bdi>] as [string, ReactNode]] : []),
    ...clientFacts.slice(1),
    [t('projectForm.startDate'), project.startDate ? formatDay(project.startDate, lang, 'long') : none],
    [t('projectForm.endDate'), project.continuous ? t('projects.continuous') : project.targetEndDate ? formatDay(project.targetEndDate, lang, 'long') : none],
  ];
  return (
    <section aria-labelledby="about-title" className="panel flex flex-col gap-5 p-5">
      <h2 id="about-title" className="text-section text-ink">{t('project.about')}</h2>
      <ProjectPlace detail={detail} />
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
