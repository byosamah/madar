import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePersistentChoice } from '../../app/choices';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { ChipGroup } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { SegmentedControl } from '../../components/SegmentedControl';
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectCard } from './ProjectCard';
import { ProjectRow } from './ProjectRow';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const SORTS = ['updated', 'deadline', 'name'] as const;
const VIEWS = ['grid', 'list'] as const;
const SELECT = 'min-h-11 rounded-full bg-fill px-4 text-subheadline text-label';

/** The home screen: a grid of project cards with filters, sort and a list view (spec 4.3). */
export function ProjectsScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('active');
  const [sort, setSort] = usePersistentChoice('madar.projects.sort', SORTS, 'updated');
  const [view, setView] = usePersistentChoice('madar.projects.view', VIEWS, 'grid');
  const [creating, setCreating] = useState(false);
  const settings = useCall('settings.get', {});
  const stageName = filter.startsWith('stage:') ? filter.slice('stage:'.length) : undefined;
  const list = useCall('projects.list', {
    status,
    sort,
    filter: stageName ? 'all' : (filter as 'all' | 'mine' | 'at_risk'),
    stageName,
  });
  const chips = [
    { value: 'all', label: t('projects.filter.all') },
    { value: 'mine', label: t('projects.filter.mine') },
    { value: 'at_risk', label: t('projects.filter.at_risk') },
    ...(settings.data?.defaultStages ?? []).map((name) => ({ value: `stage:${name}`, label: name })),
  ];
  const showAll = () => {
    setFilter('all');
    setStatus('all');
  };

  let body = null;
  if (list.error) {
    body = <EmptyState title={t('projects.loadFailed')} body={errorMessage(list.error, t)} action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>} />;
  } else if (list.data && list.data.length === 0) {
    body = <EmptyState title={t('projects.emptyTitle')} body={t('projects.empty')} action={<Button onClick={showAll}>{t('projects.showAll')}</Button>} />;
  } else if (list.data && view === 'grid') {
    body = (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[90rem]:grid-cols-4">
        {list.data.map((summary) => <li key={summary.project.id}><ProjectCard summary={summary} /></li>)}
      </ul>
    );
  } else if (list.data) {
    body = <ul className="flex flex-col gap-2">{list.data.map((summary) => <ProjectRow key={summary.project.id} summary={summary} />)}</ul>;
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle title={t('screens.projects')} />
        <Button variant="primary" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden />
          {t('projects.new')}
        </Button>
      </div>
      <div className="flex flex-col gap-3 pb-5">
        <ChipGroup label={t('projects.filters')} value={filter} options={chips} onChange={setFilter} />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t('projects.statusFilter')} value={status} onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])} className={SELECT}>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
          </select>
          <select aria-label={t('projects.sort')} value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number])} className={SELECT}>
            {SORTS.map((value) => <option key={value} value={value}>{t(`projects.sorts.${value}`)}</option>)}
          </select>
          <div className="ms-auto">
            <SegmentedControl label={t('projects.view')} value={view} onChange={setView} options={VIEWS.map((value) => ({ value, label: t(`projects.views.${value}`) }))} />
          </div>
        </div>
      </div>
      {body}
      <NewProjectSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}
