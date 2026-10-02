import { useQueryClient } from '@tanstack/react-query';
import { LayoutGroup } from 'motion/react';
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
import { sharedSource } from '../../app/sharedLayout';
import { HeaderShell, ProjectHeader } from './ProjectHeader';
import { PausedBanner } from './PausedBanner';
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

  // A failed refresh keeps the project on screen: the error page shows only when there is no data (audit 2026-10-03, PRJ-1).
  if (detail.error && !detail.data) {
    const gone = detail.error instanceof ApiError && detail.error.code === 'not_found';
    const title = gone ? t('project.notFoundTitle') : t('common.loadFailed');
    return (
      <>
        <ScreenTitle title={title} />
        <EmptyState
          title={title}
          body={gone ? t('project.notFound') : errorMessage(detail.error, t)}
          action={gone
            ? <Link to="/projects" className="pressable inline-flex min-h-11 items-center font-semibold text-link">{t('project.back')}</Link>
            : <Button onClick={() => void detail.refetch()}>{t('common.retry')}</Button>}
        />
      </>
    );
  }
  if (!detail.data) {
    const summary = queryClient.getQueriesData<ProjectSummary[]>({ queryKey: ['api', 'projects.list'] })
      .flatMap(([, list]) => list ?? []).find((item) => item.project.id === projectId);
    return summary ? <LayoutGroup id={sharedSource()}><HeaderShell id={summary.project.id} name={summary.project.name} mark={summary.project.mark} /></LayoutGroup> : null;
  }
  const Body = TAB_BODY[tab];
  return (
    <div className="flex flex-col gap-5">
      <LayoutGroup id={sharedSource()}>
        <ProjectHeader detail={detail.data} onPost={() => setParams({ tab: 'activity', compose: '1' })} />
      </LayoutGroup>
      <PausedBanner detail={detail.data} />
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
