import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/Fields';
import { ScreenTitle } from '../../components/ScreenTitle';
import { oneOf } from '../../lib/params';
import { Charts } from './Charts';
import { Tiles } from './Tiles';
import { Workload } from './Workload';

const PERIODS = ['month', 'quarter', 'year'] as const;
const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const USER_ID = /^usr_\d{3,}$/;
const CLIENT_ID = /^cli_\d{3,}$/;

/** Everyone sees the same dashboard (spec 8). The filters live in the link and apply to every number on the screen. */
export function DashboardScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const period = oneOf(params.get('period'), PERIODS, 'month');
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const leader = params.get('leader') ?? '';
  const client = params.get('client') ?? '';
  const dashboard = useCall('dashboard.get', {
    period,
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
  const view = dashboard.data;
  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('screens.dashboard')} />
      <section aria-label={t('dashboard.filters')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SelectField id="dash-period" label={t('dashboard.period')} value={period} onChange={(event) => set('period', event.target.value, 'month')}>
          {PERIODS.map((value) => <option key={value} value={value}>{t(`dashboard.periods.${value}`)}</option>)}
        </SelectField>
        <SelectField id="dash-status" label={t('dashboard.statusLabel')} value={status} onChange={(event) => set('status', event.target.value, 'active')}>
          {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
        </SelectField>
        <SelectField id="dash-leader" label={t('dashboard.leader')} value={leader} onChange={(event) => set('leader', event.target.value, '')}>
          <option value="">{t('dashboard.anyLeader')}</option>
          {(users.data ?? []).filter((user) => user.kind === 'human').map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </SelectField>
        <SelectField id="dash-client" label={t('dashboard.client')} value={client} onChange={(event) => set('client', event.target.value, '')}>
          <option value="">{t('dashboard.anyClient')}</option>
          {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </section>
      {dashboard.error && (
        <EmptyState title={t('screens.dashboard')} body={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>} />
      )}
      {view && (
        <>
          <Tiles view={view} />
          <Charts view={view} />
          <Workload view={view} />
        </>
      )}
    </div>
  );
}
