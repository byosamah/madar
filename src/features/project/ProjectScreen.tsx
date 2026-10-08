import { useQueryClient } from '@tanstack/react-query';
import { LayoutGroup } from 'motion/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/errors';
import { errorMessage } from '../../app/errors';
import { usePrefetchCall } from '../../app/prefetch';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import type { ProjectSummary } from '../../api/contract/views';
import { sharedSource } from '../../app/sharedLayout';
import { HeaderShell, ProjectHeader } from './ProjectHeader';
import { PausedBanner } from './PausedBanner';
import { prefetchReads, sessionSeesPayments } from './reads';
import { FILTER_PARAMS, PROJECT_TABS, TAB_BODY, tabReads, type ProjectTab } from './tabs';

/** One project with the tabs Overview, Tasks, Schedule, Files and Team (spec 5). The tab lives in the link. */
export function ProjectScreen() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: ProjectTab = PROJECT_TABS.includes(raw as ProjectTab) ? (raw as ProjectTab) : 'overview';
  const detail = useCall('projects.get', { id: projectId });
  const queryClient = useQueryClient();
  // The reads of the open tab start with projects.get, in an effect, so the tab and its panel show after one round trip
  // (performance audit 2026-10-07, FET-2 and LIV-1). Every gate below stays: only the start time of the reads changes.
  const prefetch = usePrefetchCall();
  const reads = tabReads(tab, projectId, params, { payments: sessionSeesPayments(queryClient) });
  const readsKey = JSON.stringify(reads);
  useEffect(() => {
    prefetchReads(prefetch, reads);
    // readsKey holds the content of reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetch, readsKey]);

  // A failed refresh keeps the project on screen: the error page shows only when there is no data (audit 2026-10-03, PRJ-1).
  if (detail.error && !detail.data) {
    const gone = detail.error instanceof ApiError && detail.error.code === 'not_found';
    const title = gone ? t('project.notFoundTitle') : t('common.loadFailed');
    return (
      <>
        <ScreenTitle title={title} />
        {/* The card does not say the page title again (audit 2026-10-03, V-34). */}
        <EmptyState
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
        onChange={(next) => setParams((current) => {
          // A trip to another tab keeps the filters of the tabs, and drops an open panel (audit 2026-10-03, PRJ-22).
          const value = new URLSearchParams({ tab: next });
          for (const key of FILTER_PARAMS) {
            const kept = current.get(key);
            if (kept) value.set(key, kept);
          }
          return value;
        })}
        options={PROJECT_TABS.map((value) => ({ value, label: t(`project.tab.${value}`) }))}
      />
      <TabPanel value={tab}>
        {Body ? <Body detail={detail.data} /> : <EmptyState title={t(`project.tab.${tab}`)} body={t('project.comingSoon')} />}
      </TabPanel>
    </div>
  );
}
