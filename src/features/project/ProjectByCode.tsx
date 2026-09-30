import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';

/** "#KH-26-014" in a post or comment links here (spec 7.2). The screen finds the project by its code. */
export function ProjectByCode() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const list = useCall('projects.list', { status: 'all' });
  if (!list.data) return null;
  const match = list.data.find((summary) => summary.project.code === code);
  if (match) return <Navigate replace to={`/projects/${match.project.id}`} />;
  return (
    <>
      <ScreenTitle title={t('project.notFoundTitle')} />
      <EmptyState title={t('project.notFoundTitle')} body={t('project.notFound')} />
    </>
  );
}
