import { AnimatePresence, LayoutGroup } from 'motion/react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../app/choices';
import { rememberProjectsList } from '../../app/lastList';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import type { ProjectSummary } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { useStableHandler } from '../../app/useStableHandler';
import { useRight } from '../../app/useRight';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FilterButton } from '../../components/FilterButton';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { clientName } from '../../lib/clientName';
import { clientParam, oneOf, subCompanyParam, teamParam, userParam } from '../../lib/params';
import { NewProjectSheet, usePrepareNewProject } from './NewProjectSheet';
import { ProjectListRow } from './ProjectListRow';
import { PROJECT_SORT_KEY, PROJECT_SORTS } from './sort';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const FILTERS = ['all', 'mine', 'at_risk'] as const;
/** The data gaps that the Dashboard opens for the Admin (owner, 2026-10-06). Only a link sets them, like the health. */
const GAPS = ['no_area', 'stage_no_end', 'no_sub_company'] as const;
const HEALTH = ['on_track', 'at_risk', 'late'] as const;
const SORTS = PROJECT_SORTS;
/** The value of the "No sub-company" choice in the Sub-company select. */
const NO_SUB_COMPANY = 'none';
const SELECT = 'field mt-1.5 font-normal';
const LEGEND = 'pb-1 text-footnote font-semibold text-ink-2';

/**
 * The list, its empty state or its error. It takes only plain props and stable handlers, so New project, which opens a form
 * over the list, does not render the rows again (performance audit 2026-10-07, RND-2).
 */
const ProjectsBody = memo(function ProjectsBody({ rows, error, onRetry, onShowAll }: {
  rows: ProjectSummary[] | undefined; error: unknown; onRetry: () => void; onShowAll: () => void;
}) {
  const { t } = useTranslation();
  if (error) {
    return <EmptyState title={t('projects.loadFailed')} body={errorMessage(error, t)} action={<Button onClick={onRetry}>{t('common.retry')}</Button>} />;
  }
  if (rows && rows.length === 0) {
    return <EmptyState title={t('projects.emptyTitle')} body={t('projects.empty')} action={<Button onClick={onShowAll}>{t('projects.showAll')}</Button>} />;
  }
  if (!rows) return null;
  return (
    <LayoutGroup id="projects">
      <ul aria-label={t('screens.projects')} className="@container panel hairline overflow-hidden">
        <AnimatePresence initial={false}>
          {rows.map((summary) => <ProjectListRow key={summary.project.id} summary={summary} source="projects" />)}
        </AnimatePresence>
      </ul>
    </LayoutGroup>
  );
});

/** Every project as one calm list, with one filter button (redesign spec 3.3). */
export function ProjectsScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  useEffect(() => rememberProjectsList(search ? `?${search}` : ''), [search]);
  const stageName = params.get('stage') ?? undefined;
  const filterParam = oneOf(params.get('filter'), FILTERS, 'all');
  const gap = GAPS.find((value) => value === params.get('filter'));
  const filter = stageName ? `stage:${stageName}` : filterParam;
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const teamId = teamParam(params.get('team'));
  // The Dashboard opens this list with its Leader and Client filters too, so the list holds the projects it counted (owner, 2026-10-06).
  const leaderId = userParam(params.get('leader'));
  const clientId = clientParam(params.get('client'));
  // The sub-company of the project (fbk_007). The filter shows only when the office has sub-companies.
  const subCompanyId = subCompanyParam(params.get('subCompany'));
  const healthParam = params.get('health');
  const health = HEALTH.includes(healthParam as (typeof HEALTH)[number]) ? (healthParam as (typeof HEALTH)[number]) : undefined;
  // The filters live in the link, so the dashboard can open this screen with a filter set (spec 8.2).
  const update = (change: (next: URLSearchParams) => void) => setParams((current) => {
    const next = new URLSearchParams(current);
    change(next);
    return next;
  }, { replace: true });
  // Show and Stage are two separate choices (spec 3.3), so one never clears the other (audit PER-5).
  const setFilter = (value: string) => update((next) => {
    next.delete('filter');
    next.delete('health');
    if (value !== 'all') next.set('filter', value);
  });
  // "No sub-company" is the gap filter no_sub_company. Any other choice leaves that filter.
  const setSubCompany = (value: string) => update((next) => {
    next.delete('subCompany');
    if (next.get('filter') === 'no_sub_company') next.delete('filter');
    if (value === NO_SUB_COMPANY) next.set('filter', 'no_sub_company');
    else if (value) next.set('subCompany', value);
  });
  const setStage = (name: string) => update((next) => (name ? next.set('stage', name) : next.delete('stage')));
  const setStatus = (value: (typeof STATUSES)[number]) => update((next) => {
    if (value === 'active') next.delete('status');
    else next.set('status', value);
  });
  const [sort, setSort] = usePersistentChoice(PROJECT_SORT_KEY, SORTS, 'updated');
  const [creating, setCreating] = useState(false);
  // "New project" needs project.create (role rights version 2).
  const mayCreate = useRight('project.create');
  const prepareNew = usePrepareNewProject();
  const settings = useCall('settings.get', {});
  const teams = useCall('teams.list', {});
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const subCompanies = useCall('subCompanies.list', {});
  const people = (users.data ?? []).filter((user) => user.kind === 'human').sort(byName);
  const list = useCall('projects.list', {
    status,
    sort,
    filter: gap ?? filterParam,
    stageName,
    health,
    teamId,
    leaderId,
    clientId,
    subCompanyId,
  });
  const active = [filterParam !== 'all' || gap, stageName, status !== 'active', sort !== 'updated', teamId, leaderId, clientId, subCompanyId].filter(Boolean).length;
  const setParam = (key: string, value: string) => update((next) => (value ? next.set(key, value) : next.delete(key)));
  const showAll = useStableHandler(() => setParams({ status: 'all' }, { replace: true }));
  const retry = useStableHandler(() => void list.refetch());
  return (
    <>
      <ScreenTitle
        title={t('screens.projects')}
        action={mayCreate ? (
          <Button variant="primary" className="shrink-0" onPointerDown={prepareNew} onClick={() => setCreating(true)}>
            <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
            {t('projects.new')}
          </Button>
        ) : undefined}
      />
      <ScreenControls>
        <FilterButton label={t('filter.label')} count={active}>
          <fieldset className="flex flex-col">
            <legend className={LEGEND}>{t('projects.show')}</legend>
            {FILTERS.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="radio" name="projects-show" checked={filterParam === value} onChange={() => setFilter(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`projects.filter.${value}`)}
              </label>
            ))}
          </fieldset>
          <label className={LEGEND}>
            {t('projects.stage')}
            <select value={stageName ?? ''} onChange={(event) => setStage(event.target.value)} className={SELECT}>
              <option value="">{t('projects.anyStage')}</option>
              {(settings.data?.defaultStages ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className={LEGEND}>
            {t('projects.team')}
            <select value={teamId ?? ''} onChange={(event) => update((next) => (event.target.value ? next.set('team', event.target.value) : next.delete('team')))} className={SELECT}>
              <option value="">{t('projects.anyTeam')}</option>
              {(teams.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className={LEGEND}>
            {t('projects.leader')}
            <select value={leaderId ?? ''} onChange={(event) => setParam('leader', event.target.value)} className={SELECT}>
              <option value="">{t('projects.anyLeader')}</option>
              {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
            </select>
          </label>
          <label className={LEGEND}>
            {t('projects.client')}
            <select value={clientId ?? ''} onChange={(event) => setParam('client', event.target.value)} className={SELECT}>
              <option value="">{t('projects.anyClient')}</option>
              {(clients.data ?? []).map((client) => <option key={client.id} value={client.id}>{clientName(client, lang)}</option>)}
            </select>
          </label>
          {(subCompanies.data ?? []).length > 0 && (
            <label className={LEGEND}>
              {t('subCompanies.label')}
              <select value={gap === 'no_sub_company' ? NO_SUB_COMPANY : subCompanyId ?? ''} onChange={(event) => setSubCompany(event.target.value)} className={SELECT}>
                <option value="">{t('subCompanies.any')}</option>
                {(subCompanies.data ?? []).map((sub) => <option key={sub.id} value={sub.id}>{lang === 'ar' ? sub.nameAr : sub.name}</option>)}
                {/* The old projects that no one has placed yet: the Admin fills them in (INT-10). */}
                <option value={NO_SUB_COMPANY}>{t('subCompanies.none')}</option>
              </select>
            </label>
          )}
          <label className={LEGEND}>
            {t('projects.statusFilter')}
            <select value={status} onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])} className={SELECT}>
              {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
          </label>
          <label className={LEGEND}>
            {t('projects.sort')}
            <select value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number])} className={SELECT}>
              {SORTS.map((value) => <option key={value} value={value}>{t(`projects.sorts.${value}`)}</option>)}
            </select>
          </label>
        </FilterButton>
        {gap && (
          <p className="flex items-center gap-2 text-subheadline text-ink">
            <span className="rounded-full bg-fill px-3 py-1.5">{t(`projects.gap.${gap}`)}</span>
            <Button variant="plain" onClick={() => update((next) => next.delete('filter'))}>{t('projects.showAll')}</Button>
          </p>
        )}
        {health && (
          <p className="flex items-center gap-2 text-subheadline text-ink">
            <span className="rounded-full bg-fill px-3 py-1.5">{t('projects.healthFilter', { health: t(`health.${health}`) })}</span>
            <Button variant="plain" onClick={() => update((next) => next.delete('health'))}>{t('projects.clearHealth')}</Button>
          </p>
        )}
      </ScreenControls>
      <ProjectsBody rows={list.data} error={list.error} onRetry={retry} onShowAll={showAll} />
      {mayCreate && <NewProjectSheet open={creating} onOpenChange={setCreating} />}
    </>
  );
}
