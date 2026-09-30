import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import { WORK_TAB_BODY, WORK_TABS, type WorkTab } from './tabs';
import { WorkTasks } from './WorkTasks';

/** My tasks from all projects, and my timesheet (spec 6). The tab lives in the link. */
export function WorkScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: WorkTab = WORK_TABS.includes(raw as WorkTab) ? (raw as WorkTab) : 'tasks';
  const Hours = WORK_TAB_BODY.hours;
  let body = <WorkTasks />;
  if (tab === 'hours') body = Hours ? <Hours /> : <EmptyState title={t('work.tab.hours')} body={t('project.comingSoon')} />;
  return (
    <div className="flex flex-col gap-4">
      <ScreenTitle title={t('screens.myWork')} />
      <Tabs label={t('work.tabs')} value={tab} idPrefix="work" onChange={(next) => setParams({ tab: next })} options={WORK_TABS.map((value) => ({ value, label: t(`work.tab.${value}`) }))} />
      <TabPanel value={tab} idPrefix="work">{body}</TabPanel>
    </div>
  );
}
