import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FilterButton } from '../../components/FilterButton';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import { addDays, formatNumber, todayISO } from '../../lib/dates';
import { oneOf } from '../../lib/params';
import { HealthMix, PerStage, Throughput } from './Charts';
import { NumberRows, Numbers } from './Numbers';
import { OfficeSchedule } from './OfficeSchedule';
import { Workload } from './Workload';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const VIEWS = ['projects', 'people', 'schedule'] as const;
const USER_ID = /^usr_\d{3,}$/;
const CLIENT_ID = /^cli_\d{3,}$/;
const LABEL = 'flex flex-col gap-1 text-footnote font-semibold text-ink-2';
const SELECT = 'min-h-11 w-full rounded-control bg-fill px-3 text-body font-normal text-ink';

/**
 * Everyone sees the same dashboard (spec 8). Three numbers, then one section at a time (redesign spec 3.6).
 * The filters and the section live in the link and apply to every number on the screen.
 */
export function DashboardScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const section = oneOf(params.get('view'), VIEWS, 'projects');
  const leader = params.get('leader') ?? '';
  const client = params.get('client') ?? '';
  const dashboard = useCall('dashboard.get', {
    status,
    leaderId: USER_ID.test(leader) ? leader : undefined,
    clientId: CLIENT_ID.test(client) ? client : undefined,
  });
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const set = (key: string, value: string, fallback: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
  const active = [status !== 'active', leader !== '', client !== ''].filter(Boolean).length;
  const view = dashboard.data;
  const today = todayISO();
  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle title={t('screens.dashboard')} />
      <div>
        <FilterButton label={t('filter.label')} count={active}>
          <label className={LABEL}>{t('dashboard.statusLabel')}
            <select value={status} onChange={(event) => set('status', event.target.value, 'active')} className={SELECT}>
              {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t('dashboard.leader')}
            <select value={leader} onChange={(event) => set('leader', event.target.value, '')} className={SELECT}>
              <option value="">{t('dashboard.anyLeader')}</option>
              {(users.data ?? []).filter((user) => user.kind === 'human').map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t('dashboard.client')}
            <select value={client} onChange={(event) => set('client', event.target.value, '')} className={SELECT}>
              <option value="">{t('dashboard.anyClient')}</option>
              {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </FilterButton>
      </div>
      {dashboard.error && (
        <EmptyState title={t('screens.dashboard')} body={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>} />
      )}
      {view && (
        <>
          <Numbers view={view} />
          <Tabs
            label={t('dashboard.sections')}
            idPrefix="dash-section"
            value={section}
            onChange={(next) => set('view', next, 'projects')}
            options={VIEWS.map((value) => ({ value, label: t(`dashboard.views.${value}`) }))}
          />
          <TabPanel value={section} idPrefix="dash-section">
            {section === 'projects' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <NumberRows rows={[
                    { key: 'deadlines', label: t('dashboard.tiles.deadlines'), value: formatNumber(view.tiles.deadlinesNext14, lang), to: `/tasks?mode=deadlines&from=${today}&to=${addDays(today, 14)}` },
                    { key: 'area', label: t('dashboard.tiles.area'), value: t('dashboard.areaValue', { n: formatNumber(view.tiles.areaInDesign, lang) }), to: '/projects?status=active' },
                  ]} />
                </div>
                <PerStage view={view} />
                <HealthMix view={view} />
                <div className="lg:col-span-2"><Throughput view={view} /></div>
              </div>
            )}
            {section === 'people' && (
              <Workload view={view} />
            )}
            {section === 'schedule' && <OfficeSchedule view={view} />}
          </TabPanel>
        </>
      )}
    </div>
  );
}
