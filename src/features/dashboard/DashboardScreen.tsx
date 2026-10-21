import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { useRight } from '../../app/useRight';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FilterButton } from '../../components/FilterButton';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import { addDays, formatNumber, todayISO } from '../../lib/dates';
import { counted } from '../../lib/grammar';
import { oneOf, subCompanyParam, teamParam } from '../../lib/params';
import { PerStage, Submissions } from './Charts';
import { DashboardMap } from './DashboardMap';
import { DataGaps } from './DataGaps';
import { MoneyPanel } from './MoneyPanel';
import { NumberRows, Numbers } from './Numbers';
import { withFilters } from './Tiles';
import { OfficeSchedule } from './OfficeSchedule';
import { ReviewWaits } from './ReviewWaits';
import { StaleProjects } from './StaleProjects';
import { WaitingForUs } from './WaitingForUs';
import { Workload } from './Workload';
import { clientName } from '../../lib/clientName';

// Completed and Archived are not choices: every number counts active projects only, so they changed nothing a person reads.
// A link that still carries one of them reads as Active (audit 2026-10-03, DSH-13).
const STATUSES = ['active', 'on_hold', 'all'] as const;
const VIEWS = ['projects', 'people', 'schedule', 'map'] as const;
const USER_ID = /^usr_\d{3,}$/;
const CLIENT_ID = /^cli_\d{3,}$/;
const LABEL = 'flex flex-col gap-1 text-footnote font-semibold text-ink-2';
const SELECT = 'field mt-1.5 font-normal';

/**
 * Everyone sees the same dashboard (spec 8). Three numbers, then one section at a time (redesign spec 3.6).
 * The filters and the section live in the link. Leader, team and client apply to every number; the status to the schedule only.
 */
export function DashboardScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  // The Workload block needs workload.view (role rights version 2). dashboard.get gives empty rows without it.
  const mayWorkload = useRight('workload.view');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const section = oneOf(params.get('view'), VIEWS, 'projects');
  const leader = params.get('leader') ?? '';
  const client = params.get('client') ?? '';
  const team = params.get('team') ?? '';
  const teamId = teamParam(team);
  const subCompany = params.get('subCompany') ?? '';
  const subCompanyId = subCompanyParam(subCompany);
  const filters = { leaderId: USER_ID.test(leader) ? leader : undefined, clientId: CLIENT_ID.test(client) ? client : undefined, teamId, subCompanyId };
  // Status changes only the rows of the schedule: every number, chart and workload counts active projects, so a Paused there
  // read 0 everywhere. The choice shows in the Schedule section only, and elsewhere a status in the link reads as Active
  // (audit 2026-10-03, V-12). With Active, both calls are one.
  const statusApplies = section === 'schedule';
  const shown = statusApplies ? status : 'active';
  const dashboard = useCall('dashboard.get', { status: 'active', ...filters });
  const scheduled = useCall('dashboard.get', { status: shown, ...filters });
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const teams = useCall('teams.list', {});
  const subCompanies = useCall('subCompanies.list', {});
  const set = (key: string, value: string, fallback: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
  // The meeting view takes the filters, not the section, and the status only where the person sees it.
  const meetingSearch = new URLSearchParams([...params].filter(([key]) => [...(statusApplies ? ['status'] : []), 'leader', 'client', 'team', 'subCompany'].includes(key))).toString();
  const active = [statusApplies && status !== 'active', leader !== '', client !== '', team !== '', subCompany !== ''].filter(Boolean).length;
  const view = dashboard.data;
  const today = todayISO();
  // A person who leads no project in the status gave an empty Dashboard. The Leader list offers only the people who lead a
  // project in the status the numbers count; "All statuses" shows active and paused projects (audit 2026-10-03, F-14).
  // dashboard.get names them, so the screen loads no summary of every project (cleanup 2026-10-06).
  const leaders = new Map<string, string>();
  for (const person of scheduled.data?.leaders ?? []) leaders.set(person.id, nameOf(person));
  // A leader from the link stays in the list, so the choice that filters the numbers stays visible.
  const picked = (users.data ?? []).find((user) => user.id === leader);
  if (picked) leaders.set(picked.id, nameOf(picked));
  const leaderOptions = [...leaders].sort(([, a], [, b]) => a.localeCompare(b, lang));
  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle title={t('screens.dashboard')} />
      <div className="flex flex-wrap items-center gap-2">
        <FilterButton label={t('filter.label')} count={active}>
          {statusApplies && (
            <label className={LABEL}>{t('dashboard.statusLabel')}
              <select value={status} onChange={(event) => set('status', event.target.value, 'active')} className={SELECT}>
                {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
              </select>
            </label>
          )}
          <label className={LABEL}>{t('dashboard.leader')}
            <select value={leader} onChange={(event) => set('leader', event.target.value, '')} className={SELECT}>
              <option value="">{t('dashboard.anyLeader')}</option>
              {leaderOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t('dashboard.team')}
            <select value={team} onChange={(event) => set('team', event.target.value, '')} className={SELECT}>
              <option value="">{t('dashboard.anyTeam')}</option>
              {(teams.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className={LABEL}>{t('dashboard.client')}
            <select value={client} onChange={(event) => set('client', event.target.value, '')} className={SELECT}>
              <option value="">{t('dashboard.anyClient')}</option>
              {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{clientName(c, lang)}</option>)}
            </select>
          </label>
          {/* The Sub-company choice shows only when the office has sub-companies (INT-09). */}
          {(subCompanies.data ?? []).length > 0 && (
            <label className={LABEL}>{t('subCompanies.label')}
              <select value={subCompany} onChange={(event) => set('subCompany', event.target.value, '')} className={SELECT}>
                <option value="">{t('subCompanies.any')}</option>
                {(subCompanies.data ?? []).map((item) => <option key={item.id} value={item.id}>{lang === 'ar' ? item.nameAr : item.name}</option>)}
              </select>
            </label>
          )}
        </FilterButton>
        <Button variant="primary" onClick={() => navigate({ pathname: '/dashboard/meeting', search: meetingSearch })}>{t('dashboard.meetingButton')}</Button>
        <Button onClick={() => navigate({ pathname: '/dashboard/space', search: meetingSearch })}>{t('space.openButton')}</Button>
      </div>
      {dashboard.error && (
        <EmptyState title={t('screens.dashboard')} body={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>} />
      )}
      {view && (
        <>
          <Numbers view={view} filters={filters} />
          <Tabs
            label={t('dashboard.sections')}
            idPrefix="dash-section"
            value={section}
            onChange={(next) => set('view', next, 'projects')}
            options={VIEWS.map((value) => ({ value, label: t(`dashboard.views.${value}`) }))}
          />
          <TabPanel value={section} idPrefix="dash-section">
            {section === 'projects' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* grid-cols-1: one auto column grows to its widest card and pushes a phone page sideways. */}
                <div className="min-w-0 empty:hidden lg:col-span-2"><StaleProjects view={view} /></div>
                <div className="min-w-0 empty:hidden lg:col-span-2"><WaitingForUs view={view} /></div>
                <div className="min-w-0 empty:hidden lg:col-span-2"><MoneyPanel view={view} /></div>
                <div className="lg:col-span-2">
                  <NumberRows rows={[
                    { key: 'deadlines', label: t('dashboard.tiles.deadlines'), value: formatNumber(view.tiles.deadlinesNext14, lang), to: withFilters(`/tasks?mode=deadlines&from=${today}&to=${addDays(today, 14)}`, filters) },
                    {
                      key: 'area', label: t('dashboard.tiles.area'), value: t('dashboard.areaValue', { n: formatNumber(view.tiles.areaInDesign, lang) }),
                      note: view.tiles.inDesignWithoutArea > 0 ? counted(t, 'dashboard.noArea', view.tiles.inDesignWithoutArea) : undefined,
                      to: withFilters('/projects?status=active', filters),
                    },
                  ]} />
                </div>
                <PerStage view={view} filters={filters} />
                <Submissions view={view} />
                <div className="min-w-0 empty:hidden lg:col-span-2"><DataGaps view={view} filters={filters} /></div>
              </div>
            )}
            {section === 'people' && (
              <div className="flex flex-col gap-4">
                <ReviewWaits view={view} />
                {mayWorkload && <Workload view={view} filters={filters} />}
              </div>
            )}
            {section === 'schedule' && scheduled.error && <EmptyState title={t('dashboard.schedule')} body={errorMessage(scheduled.error, t)} action={<Button onClick={() => void scheduled.refetch()}>{t('common.retry')}</Button>} />}
            {section === 'schedule' && scheduled.data && <OfficeSchedule view={scheduled.data} />}
            {section === 'map' && <DashboardMap filters={filters} />}
          </TabPanel>
        </>
      )}
    </div>
  );
}
