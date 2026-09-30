import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../../app/choices';
import { useCall } from '../../../app/runtime';
import { ChipGroup } from '../../../components/Chip';
import { SegmentedControl } from '../../../components/SegmentedControl';
import type { TabProps } from '../tabs';
import { TaskBoard } from './TaskBoard';
import { TaskList } from './TaskList';
import { TaskSheet } from './TaskSheet';

const FILTERS = ['all', 'mine', 'overdue', 'flagged'] as const;
const VIEWS = ['list', 'board'] as const;

export function TasksTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [view, setView] = usePersistentChoice('madar.tasks.view', VIEWS, 'list');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [showDone, setShowDone] = useState(false);
  const tasks = useCall('tasks.list', { projectId: detail.project.id, filter, activeProjectsOnly: false });
  const rows = tasks.data ?? [];
  const open = (taskId: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', taskId);
    return next;
  });
  const closeTask = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    return next;
  }), [setParams]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup label={t('tasks.filters')} value={filter} onChange={setFilter} options={FILTERS.map((value) => ({ value, label: t(`tasks.filter.${value}`) }))} />
        <div className="ms-auto flex flex-wrap items-center gap-3">
          {view === 'list' && (
            <label className="flex min-h-11 items-center gap-2 text-subheadline">
              <input type="checkbox" className="size-5 accent-[var(--c-accent-fill)]" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
          <SegmentedControl label={t('tasks.view')} value={view} onChange={setView} options={VIEWS.map((value) => ({ value, label: t(`tasks.views.${value}`) }))} />
        </div>
      </div>
      {tasks.data && (view === 'list'
        ? <TaskList detail={detail} rows={showDone ? rows : rows.filter((row) => row.task.status !== 'done')} filtered={filter !== 'all'} onOpen={open} />
        : <TaskBoard rows={rows} onOpen={open} />)}
      {params.get('task') && <TaskSheet key={params.get('task')} taskId={params.get('task') as string} detail={detail} onClose={closeTask} />}
    </div>
  );
}
