import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../../app/choices';
import { useCall } from '../../../app/runtime';
import { FilterButton } from '../../../components/FilterButton';
import { oneOf } from '../../../lib/params';
import { LoadFailed } from '../../../components/LoadFailed';
import { setFilterParam, type TabProps } from '../tabs';
import { TaskBoard } from './TaskBoard';
import { TaskList } from './TaskList';
import { TaskSheet } from './TaskSheet';

const FILTERS = ['all', 'mine', 'overdue', 'flagged'] as const;
const VIEWS = ['list', 'board'] as const;
const LEGEND = 'pb-1 text-footnote font-semibold text-ink-2';
const RADIO = 'flex min-h-11 items-center gap-3 text-body text-ink';

export function TasksTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [view, setView] = usePersistentChoice('madar.tasks.view', VIEWS, 'list');
  // Show and "Show done tasks" live in the link, so a reload, Back or a trip to another tab keeps them (audit 2026-10-03, PRJ-22).
  const filter = oneOf(params.get('show'), FILTERS, 'all');
  const showDone = params.get('done') === '1';
  const setFilter = (value: (typeof FILTERS)[number]) => setFilterParam(setParams, 'show', value === 'all' ? null : value);
  const setShowDone = (on: boolean) => setFilterParam(setParams, 'done', on ? '1' : null);
  const tasks = useCall('tasks.list', { projectId: detail.project.id, filter, activeProjectsOnly: false });
  const rows = tasks.data ?? [];
  // Hidden done tasks still count, so a finished stage says so instead of "No tasks here yet." (plan 5 clarification 3).
  const doneCounts: Record<string, number> = {};
  for (const row of rows) if (row.task.status === 'done') doneCounts[row.task.stageId] = (doneCounts[row.task.stageId] ?? 0) + 1;
  const open = (taskId: string, thread = false) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', taskId);
    if (thread) next.set('thread', '1');
    else next.delete('thread');
    return next;
  });
  // Close replaces the link, so Back does not open the closed panel again (audit 2026-10-03, PRJ-9).
  const closeTask = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('thread');
    return next;
  }, { replace: true }), [setParams]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterButton label={t('filter.label')} count={[filter !== 'all', showDone && view === 'list'].filter(Boolean).length}>
          <fieldset className="flex flex-col">
            <legend className={LEGEND}>{t('projects.show')}</legend>
            {FILTERS.map((value) => (
              <label key={value} className={RADIO}>
                <input type="radio" name="tasks-show" checked={filter === value} onChange={() => setFilter(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`tasks.filter.${value}`)}
              </label>
            ))}
          </fieldset>
          {view === 'list' && (
            <label className={`${RADIO} border-t border-hairline pt-1`}>
              <input type="checkbox" className="size-5 accent-[var(--sig-from)]" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
          <fieldset className="flex flex-col border-t border-hairline pt-2">
            <legend className={LEGEND}>{t('tasks.view')}</legend>
            {VIEWS.map((value) => (
              <label key={value} className={RADIO}>
                <input type="radio" name="tasks-view" checked={view === value} onChange={() => setView(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`tasks.views.${value}`)}
              </label>
            ))}
          </fieldset>
        </FilterButton>
      </div>
      {/* A list that did not load says so and offers Retry, never an empty tab (audit 2026-10-03, PRJ-4). */}
      {tasks.error && !tasks.data && <LoadFailed error={tasks.error} onRetry={() => void tasks.refetch()} />}
      {tasks.data && (view === 'list'
        ? <TaskList detail={detail} rows={showDone ? rows : rows.filter((row) => row.task.status !== 'done')} filtered={filter !== 'all'} onOpen={open} doneCounts={showDone ? {} : doneCounts} />
        : <TaskBoard rows={rows} onOpen={open} />)}
      {params.get('task') && <TaskSheet key={params.get('task')} taskId={params.get('task') as string} detail={detail} onClose={closeTask} />}
    </div>
  );
}
