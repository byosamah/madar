import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/errors';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import type { ProjectSummary } from '../../api/contract/views';
import { ProjectCover } from '../projects/ProjectCard';
import { HEADER_COVER, ProjectHeader } from './ProjectHeader';
import { PROJECT_TABS, TAB_BODY, type ProjectTab } from './tabs';

/** One project with the tabs Overview, Tasks, Schedule, Files and Team (spec 5). The tab lives in the link. */
export function ProjectScreen() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: ProjectTab = PROJECT_TABS.includes(raw as ProjectTab) ? (raw as ProjectTab) : 'overview';
  const detail = useCall('projects.get', { id: projectId });
  const queryClient = useQueryClient();

  if (detail.error) {
    const gone = detail.error instanceof ApiError && detail.error.code === 'not_found';
    return (
      <>
        <ScreenTitle title={t('project.notFoundTitle')} />
        <EmptyState
          title={t('project.notFoundTitle')}
          body={gone ? t('project.notFound') : errorMessage(detail.error, t)}
          action={gone
            ? <Link to="/" className="pressable inline-flex min-h-11 items-center font-semibold text-accent">{t('project.back')}</Link>
            : <Button onClick={() => void detail.refetch()}>{t('common.retry')}</Button>}
        />
      </>
    );
  }
  if (!detail.data) {
    // The cover draws at once from the project list, with the card's layoutId, so the card grows into it while the project loads (spec 10.6).
    const summary = queryClient.getQueriesData<ProjectSummary[]>({ queryKey: ['api', 'projects.list'] })
      .flatMap(([, list]) => list ?? []).find((item) => item.project.id === projectId);
    if (!summary) return null;
    return (
      <div className="relative overflow-hidden rounded-card">
        <ProjectCover summary={summary} className={HEADER_COVER} layoutId={`cover-${projectId}`} />
      </div>
    );
  }
  const Body = TAB_BODY[tab];
  return (
    <div className="flex flex-col gap-5">
      <ProjectHeader detail={detail.data} onPost={() => setParams({ tab: 'overview', compose: '1' })} />
      <Tabs
        label={t('project.tabs')}
        value={tab}
        onChange={(next) => setParams({ tab: next })}
        options={PROJECT_TABS.map((value) => ({ value, label: t(`project.tab.${value}`) }))}
      />
      <TabPanel value={tab}>
        {Body ? <Body detail={detail.data} /> : <EmptyState title={t(`project.tab.${tab}`)} body={t('project.comingSoon')} />}
      </TabPanel>
    </div>
  );
}
