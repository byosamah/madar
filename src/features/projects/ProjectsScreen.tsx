import { AnimatePresence, LayoutGroup } from 'motion/react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../app/choices';
import { rememberProjectsList } from '../../app/lastList';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FilterButton } from '../../components/FilterButton';
import { ScreenTitle } from '../../components/ScreenTitle';
import { oneOf } from '../../lib/params';
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectListRow } from './ProjectListRow';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const FILTERS = ['all', 'mine', 'at_risk'] as const;
const HEALTH = ['on_track', 'at_risk', 'late'] as const;
const SORTS = ['updated', 'deadline', 'name'] as const;
const SELECT = 'mt-1 min-h-11 w-full rounded-control bg-fill px-3 text-body font-normal text-ink';
const LEGEND = 'pb-1 text-footnote font-semibold text-ink-2';

/** Every project as one calm list, with one filter button (redesign spec 3.3). */
export function ProjectsScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  useEffect(() => rememberProjectsList(search ? `?${search}` : ''), [search]);
  const stageName = params.get('stage') ?? undefined;
  const filterParam = oneOf(params.get('filter'), FILTERS, 'all');
  const filter = stageName ? `stage:${stageName}` : filterParam;
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const healthParam = params.get('health');
  const health = HEALTH.includes(healthParam as (typeof HEALTH)[number]) ? (healthParam as (typeof HEALTH)[number]) : undefined;
  // The filters live in the link, so the dashboard can open this screen with a filter set (spec 8.2).
  const update = (change: (next: URLSearchParams) => void) => setParams((current) => {
    const next = new URLSearchParams(current);
    change(next);
    return next;
  }, { replace: true });
  const setFilter = (value: string) => update((next) => {
    next.delete('stage');
    next.delete('filter');
    next.delete('health');
    if (value.startsWith('stage:')) next.set('stage', value.slice('stage:'.length));
    else if (value !== 'all') next.set('filter', value);
  });
  const setStatus = (value: (typeof STATUSES)[number]) => update((next) => {
    if (value === 'active') next.delete('status');
    else next.set('status', value);
  });
  const [sort, setSort] = usePersistentChoice('madar.projects.sort', SORTS, 'updated');
  const [creating, setCreating] = useState(false);
  const settings = useCall('settings.get', {});
  const list = useCall('projects.list', {
    status,
    sort,
    filter: stageName ? 'all' : filterParam,
    stageName,
    health,
  });
  const active = [filterParam !== 'all' || stageName, status !== 'active', sort !== 'updated'].filter(Boolean).length;
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
                <input type="radio" name="projects-show" checked={!stageName && filterParam === value} onChange={() => setFilter(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`projects.filter.${value}`)}
              </label>
            ))}
          </fieldset>
          <label className={LEGEND}>
            {t('projects.stage')}
            <select value={stageName ?? ''} onChange={(event) => setFilter(event.target.value ? `stage:${event.target.value}` : 'all')} className={SELECT}>
              <option value="">{t('projects.anyStage')}</option>
              {(settings.data?.defaultStages ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
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
