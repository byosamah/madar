import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../../app/choices';
import type { ProjectDetail, TaskRow } from '../../../api/contract/views';
import { useCall } from '../../../app/runtime';
import { useStableHandler } from '../../../app/useStableHandler';
import { FilterButton } from '../../../components/FilterButton';
import { oneOf } from '../../../lib/params';
import { LoadFailed } from '../../../components/LoadFailed';
import { TASK_PANEL, usePanelLink } from '../panelLink';
import { setFilterParam, type TabProps } from '../tabs';
import { TaskBoard } from './TaskBoard';
import { TaskList } from './TaskList';
import { TaskSheet } from './TaskSheet';

const FILTERS = ['all', 'mine', 'overdue', 'flagged', 'no_lead'] as const;
const VIEWS = ['list', 'board'] as const;
const LEGEND = 'pb-1 text-footnote font-semibold text-ink-2';
const RADIO = 'flex min-h-11 items-center gap-3 text-body text-ink';

type Filter = (typeof FILTERS)[number];
type View = (typeof VIEWS)[number];

/**
 * The Filter button, the line of tasks with no lead, the error and the list or the board. It takes only plain props and stable
 * handlers, so a link change that only opens or closes the task panel does not render the rows again (performance audit
 * 2026-10-07, RND-2).
 */
const TasksBody = memo(function TasksBody({ detail, filter, showDone, view, rows, error, unledCount, onFilter, onShowDone, onView, onOpen, onSendBack, onRetry }: {
  detail: ProjectDetail; filter: Filter; showDone: boolean; view: View; rows: TaskRow[] | undefined; error: unknown; unledCount: number;
  onFilter: (value: Filter) => void; onShowDone: (on: boolean) => void; onView: (value: View) => void;
  onOpen: (taskId: string, thread?: boolean) => void; onSendBack: (taskId: string) => void; onRetry: () => void;
}) {
  const { t } = useTranslation();
  // Hidden done tasks still count, so a finished stage says so instead of "No tasks here yet." (plan 5 clarification 3).
  const doneCounts: Record<string, number> = {};
  for (const row of rows ?? []) if (row.task.status === 'done' && row.task.stageId) doneCounts[row.task.stageId] = (doneCounts[row.task.stageId] ?? 0) + 1;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <FilterButton label={t('filter.label')} count={[filter !== 'all', showDone && view === 'list'].filter(Boolean).length}>
          <fieldset className="flex flex-col">
            <legend className={LEGEND}>{t('projects.show')}</legend>
            {FILTERS.map((value) => (
              <label key={value} className={RADIO}>
                <input type="radio" name="tasks-show" checked={filter === value} onChange={() => onFilter(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`tasks.filter.${value}`)}
              </label>
            ))}
          </fieldset>
          {view === 'list' && (
            <label className={`${RADIO} border-t border-hairline pt-1`}>
              <input type="checkbox" className="size-5 accent-[var(--sig-from)]" checked={showDone} onChange={(event) => onShowDone(event.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
          <fieldset className="flex flex-col border-t border-hairline pt-2">
            <legend className={LEGEND}>{t('tasks.view')}</legend>
            {VIEWS.map((value) => (
              <label key={value} className={RADIO}>
                <input type="radio" name="tasks-view" checked={view === value} onChange={() => onView(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`tasks.views.${value}`)}
              </label>
            ))}
          </fieldset>
        </FilterButton>
        {unledCount > 0 && filter !== 'no_lead' && (
          <p className="text-footnote text-ink-2">
            {t('lead.countLine', { count: unledCount })}{' '}
            <button type="button" onClick={() => onFilter('no_lead')} className="pressable min-h-11 font-semibold text-link">{t('lead.showThem')}</button>
          </p>
        )}
      </div>
      {/* A list that did not load says so and offers Retry, never an empty tab (audit 2026-10-03, PRJ-4). */}
      {error && rows === undefined ? <LoadFailed error={error} onRetry={onRetry} /> : null}
      {rows && (view === 'list'
        ? <TaskList detail={detail} rows={showDone ? rows : rows.filter((row) => row.task.status !== 'done')} filtered={filter !== 'all'} onOpen={onOpen} doneCounts={showDone ? {} : doneCounts} />
        : <TaskBoard rows={rows} reviews={detail.viewerCan.review} onOpen={onOpen} onSendBack={onSendBack} />)}
    </>
  );
});

export function TasksTab({ detail }: TabProps) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = usePersistentChoice('madar.tasks.view', VIEWS, 'list');
  // Show and "Show done tasks" live in the link, so a reload, Back or a trip to another tab keeps them (audit 2026-10-03, PRJ-22).
  const filter = oneOf(params.get('show'), FILTERS, 'all');
  const showDone = params.get('done') === '1';
  const setFilter = useStableHandler((value: Filter) => setFilterParam(setParams, 'show', value === 'all' ? null : value));
  const setShowDone = useStableHandler((on: boolean) => setFilterParam(setParams, 'done', on ? '1' : null));
  const tasks = useCall('tasks.list', { projectId: detail.project.id, filter, activeProjectsOnly: false });
  // The template menus of the list need every template. The tab asks for them here, so they join the first request with the task
  // list, under the gates of the menu: the list view and the right to add a task (performance audit 2026-10-07, LIV-5).
  useCall('taskTemplates.list', {}, { enabled: view === 'list' && detail.viewerCan.addTask });
  const retry = useStableHandler(() => void tasks.refetch());
  // The project leader sees one gentle line with the open tasks that have no lead, and one press shows them (owner, 2026-10-05).
  // Every team member names a lead now (owner, 2026-10-07), so the line keys on the leader's review right.
  const leads = detail.viewerCan.review;
  const unled = useCall('tasks.list', { projectId: detail.project.id, filter: 'no_lead', includeDone: false, activeProjectsOnly: false }, { enabled: leads });
  const unledCount = leads ? unled.data?.length ?? 0 : 0;
  // Open adds one history step and Close goes back over it, so Back closes the panel and a panel costs no extra Back
  // (audit 2026-10-03, PRJ-9, V-36).
  const panel = usePanelLink(TASK_PANEL);
  const open = useStableHandler((taskId: string, thread: boolean = false) => panel.open({ task: taskId, thread: thread ? '1' : null }));
  // "Send back with a note" on the board opens the panel ready for the note. The choice lives here for that one opening, not in
  // the link, so Back, a reload or another task opens the plain panel (audit 2026-10-03, F-8).
  const [sendBackId, setSendBackId] = useState<string | null>(null);
  const taskParam = params.get('task');
  useEffect(() => {
    if (taskParam !== sendBackId) setSendBackId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam]);
  const sendBack = useStableHandler((taskId: string) => {
    setSendBackId(taskId);
    open(taskId);
  });
  return (
    <div className="flex flex-col gap-4">
      <TasksBody
        detail={detail}
        filter={filter}
        showDone={showDone}
        view={view}
        rows={tasks.data}
        error={tasks.error}
        unledCount={unledCount}
        onFilter={setFilter}
        onShowDone={setShowDone}
        onView={setView}
        onOpen={open}
        onSendBack={sendBack}
        onRetry={retry}
      />
      {params.get('task') && <TaskSheet key={params.get('task')} taskId={params.get('task') as string} detail={detail} onClose={panel.close} noteFirst={sendBackId === taskParam} />}
    </div>
  );
}
