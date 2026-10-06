import { AnimatePresence, LayoutGroup } from 'motion/react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../app/choices';
import { rememberProjectsList } from '../../app/lastList';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FilterButton } from '../../components/FilterButton';
import { ScreenTitle } from '../../components/ScreenTitle';
import { clientName } from '../../lib/clientName';
import { clientParam, oneOf, teamParam, userParam } from '../../lib/params';
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectListRow } from './ProjectListRow';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const FILTERS = ['all', 'mine', 'at_risk'] as const;
/** The data gaps that the Dashboard opens for the Admin (owner, 2026-10-06). Only a link sets them, like the health. */
const GAPS = ['no_area', 'stage_no_end'] as const;
const HEALTH = ['on_track', 'at_risk', 'late'] as const;
const SORTS = ['updated', 'deadline', 'name'] as const;
const SELECT = 'field mt-1.5 font-normal';
const LEGEND = 'pb-1 text-footnote font-semibold text-ink-2';

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
  const setStage = (name: string) => update((next) => (name ? next.set('stage', name) : next.delete('stage')));
  const setStatus = (value: (typeof STATUSES)[number]) => update((next) => {
    if (value === 'active') next.delete('status');
    else next.set('status', value);
  });
  const [sort, setSort] = usePersistentChoice('madar.projects.sort', SORTS, 'updated');
  const [creating, setCreating] = useState(false);
  const settings = useCall('settings.get', {});
  const teams = useCall('teams.list', {});
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
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
  });
  const active = [filterParam !== 'all' || gap, stageName, status !== 'active', sort !== 'updated', teamId, leaderId, clientId].filter(Boolean).length;
  const setParam = (key: string, value: string) => update((next) => (value ? next.set(key, value) : next.delete(key)));
  const showAll = () => setParams({ status: 'all' }, { replace: true });

  let body = null;
  if (list.error) {
    body = <EmptyState title={t('projects.loadFailed')} body={errorMessage(list.error, t)} action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>} />;
  } else if (list.data && list.data.length === 0) {
    body = <EmptyState title={t('projects.emptyTitle')} body={t('projects.empty')} action={<Button onClick={showAll}>{t('projects.showAll')}</Button>} />;
  } else if (list.data) {
    body = (
      <LayoutGroup id="projects">
        <ul aria-label={t('screens.projects')} className="@container panel hairline overflow-hidden">
          <AnimatePresence initial={false}>
            {list.data.map((summary) => <ProjectListRow key={summary.project.id} summary={summary} source="projects" />)}
          </AnimatePresence>
        </ul>
      </LayoutGroup>
    );
  }
  return (
    <>
      <ScreenTitle
        title={t('screens.projects')}
        action={(
          <Button variant="primary" className="shrink-0" onClick={() => setCreating(true)}>
            <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
            {t('projects.new')}
          </Button>
        )}
      />
      <div className="flex flex-wrap items-center gap-3 pb-4">
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
      </div>
      {body}
      <NewProjectSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}
