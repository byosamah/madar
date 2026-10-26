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
import { todayISO } from '../../lib/dates';
import { HeaderShell, ProjectHeader } from './ProjectHeader';
import { PausedBanner } from './PausedBanner';
import { prefetchReads, sessionMayAddTask, sessionSeesPayments } from './reads';
import { useIsPhone } from '../../app/useIsPhone';
import { projectsListLink } from '../../app/lastList';
import { MoreSubPage } from './MoreTab';
import { TAB_BODY, isMorePage, litPhoneTab, phoneTabsOf, tabOfLink, tabReads, tabSearch, tabsOf, type ProjectTab } from './tabs';
import { useProjectName } from '../../app/projectName';

/** A tab change on a phone brings the tab row to the top when the header has scrolled away (the row is sticky). */
function scrollToTabRow(): void {
  const top = document.querySelector('[data-tab-anchor]')?.getBoundingClientRect().top;
  if (top === undefined || top >= 0) return;
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: window.scrollY + top, behavior: reduced ? 'auto' : 'smooth' });
}

/** One project with the tabs Overview, Tasks, Schedule, Files & Links and Team (spec 5). The tab lives in the link. */
export function ProjectScreen() {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const phone = useIsPhone();
  const tab: ProjectTab = tabOfLink(raw, phone);
  const detail = useCall('projects.get', { id: projectId });
  const queryClient = useQueryClient();
  // The reads of the open tab start with projects.get, in an effect, so the tab and its panel show after one round trip
  // (performance audit 2026-10-07, FET-2 and LIV-1). Every gate below stays: only the start time of the reads changes.
  const prefetch = usePrefetchCall();
  const reads = tabReads(tab, projectId, params, { payments: sessionSeesPayments(queryClient), today: todayISO(), templates: sessionMayAddTask(queryClient) });
  const readsKey = JSON.stringify(reads);
  useEffect(() => {
    prefetchReads(prefetch, reads);
    // readsKey holds the content of reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetch, readsKey]);

  // An old link to the post box (?tab=activity&compose=1) opens the box on Overview, where a phone keeps it.
  const composeLink = params.get('compose') === '1';
  useEffect(() => {
    if (phone && tab === 'activity' && composeLink) setParams({ tab: 'overview', compose: '1' }, { replace: true });
  }, [phone, tab, composeLink, setParams]);

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
            ? <Link to={phone ? projectsListLink() : '/projects'} className="pressable inline-flex min-h-11 items-center font-semibold text-link">{t('project.back')}</Link>
            : <Button onClick={() => void detail.refetch()}>{t('common.retry')}</Button>}
        />
      </>
    );
  }
  if (!detail.data) {
    const summary = queryClient.getQueriesData<ProjectSummary[]>({ queryKey: ['api', 'projects.list'] })
      .flatMap(([, list]) => list ?? []).find((item) => item.project.id === projectId);
    return summary ? <LayoutGroup id={sharedSource()}><HeaderShell id={summary.project.id} name={projectName(summary.project)} mark={summary.project.mark} shape={summary.project.shape} /></LayoutGroup> : null;
  }
  // The tabs of this project: an internal project has no Tracker, so the address of that tab opens the Overview.
  const shown = tabsOf(detail.data.project);
  // On a phone, More is a tab of its own; Activity, Schedule and Team stay pages of it.
  const current: ProjectTab = tab === 'more' || shown.includes(tab) ? tab : 'overview';
  const Body = TAB_BODY[current];
  return (
    <div className="flex flex-col gap-5">
      <LayoutGroup id={sharedSource()}>
        <ProjectHeader detail={detail.data} tab={tab} onPost={() => setParams({ tab: phone ? 'overview' : 'activity', compose: '1' })} />
      </LayoutGroup>
      <PausedBanner detail={detail.data} />
      {phone ? (
        <>
          {/* The anchor marks where the header ends. The row below sticks to the top, so a tab change scrolls up to the anchor. */}
          <div data-tab-anchor className="-mt-5 h-0" />
          <div className="sticky top-[env(safe-area-inset-top)] z-20 -mx-4 bg-bg px-4">
            <Tabs
              spread
              label={t('project.tabs')}
              value={litPhoneTab(current)}
              onChange={(next) => {
                setParams((now) => tabSearch(now, next));
                scrollToTabRow();
              }}
              options={phoneTabsOf(detail.data.project).map((value) => ({ value, label: t(`phoneProject.tab.${value}`) }))}
            />
          </div>
        </>
      ) : (
        <Tabs
          label={t('project.tabs')}
          value={current}
          onChange={(next) => setParams((now) => tabSearch(now, next))}
          options={shown.map((value) => ({ value, label: t(`project.tab.${value}`) }))}
        />
      )}
      <TabPanel value={phone ? litPhoneTab(current) : current}>
        {phone && isMorePage(current)
          ? <MoreSubPage detail={detail.data} page={current} />
          : Body ? <Body detail={detail.data} /> : <EmptyState title={t(`project.tab.${current}`)} body={t('project.comingSoon')} />}
      </TabPanel>
    </div>
  );
}
