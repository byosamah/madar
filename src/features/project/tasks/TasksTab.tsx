import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCall } from '../../../app/runtime';
import { ChipGroup } from '../../../components/Chip';
import type { TabProps } from '../tabs';
import { TaskList } from './TaskList';

const FILTERS = ['all', 'mine', 'overdue', 'flagged'] as const;

export function TasksTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [, setParams] = useSearchParams();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [showDone, setShowDone] = useState(false);
  const tasks = useCall('tasks.list', { projectId: detail.project.id, filter, activeProjectsOnly: false });
  const rows = tasks.data ?? [];
  const open = (taskId: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', taskId);
    return next;
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup label={t('tasks.filters')} value={filter} onChange={setFilter} options={FILTERS.map((value) => ({ value, label: t(`tasks.filter.${value}`) }))} />
        <label className="ms-auto flex min-h-11 items-center gap-2 text-subheadline">
          <input type="checkbox" className="size-5 accent-[var(--c-accent-fill)]" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
          {t('tasks.showDone')}
        </label>
      </div>
      {tasks.data && <TaskList detail={detail} rows={showDone ? rows : rows.filter((row) => row.task.status !== 'done')} filtered={filter !== 'all'} onOpen={open} />}
    </div>
  );
}
