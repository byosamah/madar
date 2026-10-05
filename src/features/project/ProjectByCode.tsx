import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { ProjectTile } from '../../components/ProjectTile';
import { ScreenTitle } from '../../components/ScreenTitle';
import { LoadFailed } from '../../components/LoadFailed';
import { clientName } from '../../lib/clientName';
import { codeMatches, projectKey } from '../../lib/projectCode';

/**
 * "#KH-26-014" or "#260902AZT" in a post or comment links here (spec 7.2; owner, 2026-10-05). The screen finds the project by
 * its full code or its key. Two projects of one contract share one code, so the screen then shows them to choose from.
 */
export function ProjectByCode() {
  const { t } = useTranslation();
  const lang = useLang();
  const { code = '' } = useParams();
  const list = useCall('projects.list', { status: 'all' });
  if (list.error) return <LoadFailed error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return null;
  const matches = list.data.filter((summary) => codeMatches(summary.project.code, code))
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
  if (matches.length === 1) return <Navigate replace to={`/projects/${matches[0].project.id}`} />;
  if (matches.length > 1) {
    return (
      <>
        <ScreenTitle title={t('projectCode.sharedTitle')}>
          <span dir="ltr" className="tabular">{projectKey(matches[0].project.code)}</span>
        </ScreenTitle>
        <section className="surface flex flex-col gap-3 rounded-card p-5">
          <p className="text-subheadline text-ink-2">{t('projectCode.sharedBody')}</p>
          <ul aria-label={t('projectCode.sharedTitle')} className="hairline flex flex-col">
            {matches.map((summary) => (
              <li key={summary.project.id}>
                <Link to={`/projects/${summary.project.id}`} className="pressable flex min-h-14 items-center gap-3 py-2">
                  <ProjectTile id={summary.project.id} mark={summary.project.mark} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span dir="auto" className="truncate font-semibold text-ink">{summary.project.name}</span>
                    {summary.client && <bdi className="truncate text-footnote text-ink-2">{clientName(summary.client, lang)}</bdi>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  }
  return (
    <>
      <ScreenTitle title={t('project.notFoundTitle')} />
      <EmptyState title={t('project.notFoundTitle')} body={t('project.notFound')} />
    </>
  );
}
