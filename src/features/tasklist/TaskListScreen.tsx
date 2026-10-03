import { AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay } from '../../lib/dates';
import { dayParam, oneOf } from '../../lib/params';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { NextDeadlineLabel } from '../projects/ProjectCard';

const FILTERS = ['all', 'overdue', 'flagged'] as const;
const USER_ID = /^usr_\d{3,}$/;
const TEAM_ID = /^tm_\d{3,}$/;

/**
 * The office team in the link. The Dashboard sends it, so the list holds the tasks it counted, and the subtitle names the team
 * (audit 2026-10-03, V-37a).
 */
function useTeam(): { teamId?: string; teamText: string } {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const team = params.get('team') ?? '';
  const teamId = TEAM_ID.test(team) ? team : undefined;
  const teams = useCall('teams.list', {}, { enabled: teamId !== undefined });
  const name = teams.data?.find((item) => item.id === teamId)?.name;
  return { teamId, teamText: name ? t('taskList.team', { name }) : '' };
}

function Subtitle({ text }: { text: string }) {
  return text ? <p className="-mt-3 pb-4 text-subheadline text-label-2">{text}</p> : null;
}

/** The way back from a list the Dashboard opened. */
function BackToDashboard() {
  const { t } = useTranslation();
  return <Link to="/dashboard" className="flex min-h-11 items-center text-subheadline font-semibold text-link">{t('taskList.backToDashboard')}</Link>;
}

function DeadlineList({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { teamId, teamText } = useTeam();
  const deadlines = useCall('deadlines.list', { from, to, teamId });
  const rows = deadlines.data ?? [];
  const range = from && to ? t('taskList.dateRange', { from: formatDay(from, lang), to: formatDay(to, lang) }) : '';
  return (
    <>
      <ScreenTitle title={t('taskList.deadlinesTitle')} />
      <Subtitle text={[teamText, range].filter(Boolean).join(' · ')} />
      {deadlines.error && <LoadFailed error={deadlines.error} onRetry={() => void deadlines.refetch()} />}
      {/* The list draws only with data, so a failed or loading list shows no empty panel; an empty list says where to go (audit PER-18). */}
      {deadlines.data && rows.length === 0 && <EmptyState title={t('taskList.emptyTitle')} body={t('taskList.emptyDeadlines')} action={<BackToDashboard />} />}
      {rows.length > 0 && (
        <ul className="surface flex flex-col rounded-card p-2">
          {rows.map((row) => (
            <li key={row.deadline.id}>
              <Link to={`/projects/${row.project.id}?tab=schedule`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2 hover:bg-fill">
                <span className="min-w-0 flex-1">
                  <span className="tabular block text-footnote text-label-2">{row.project.code} · <bdi>{row.project.name}</bdi></span>
                </span>
                <NextDeadlineLabel deadline={{ id: row.deadline.id, name: row.deadline.name, date: row.deadline.date, daysLeft: row.daysLeft }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TaskResults() {
  const { t } = useTranslation();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const filter = oneOf(params.get('filter'), FILTERS, 'all');
  const owner = params.get('owner') ?? '';
  const ownerId = USER_ID.test(owner) ? owner : undefined;
  const from = dayParam(params.get('from'));
  const to = dayParam(params.get('to'));
  const createdFrom = dayParam(params.get('createdFrom'));
  const createdTo = dayParam(params.get('createdTo'));
  const doneFrom = dayParam(params.get('doneFrom'));
  const doneTo = dayParam(params.get('doneTo'));
  const { teamId, teamText } = useTeam();
  const users = useCall('users.list', { includeInactive: true });
  const tasks = useCall('tasks.list', {
    filter, ownerId, teamId, dueFrom: from, dueTo: to, createdFrom, createdTo, doneFrom, doneTo, // A created or done range counts finished tasks too, the same as the dashboard number that opens it.
    includeDone: Boolean(doneFrom || doneTo || createdFrom || createdTo),
  });
  const open = (row: TaskRow, thread = false) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', row.task.id);
    next.set('project', row.project.id);
    if (thread) next.set('thread', '1');
    else next.delete('thread');
    return next;
  });
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    next.delete('thread');
    return next;
  }), [setParams]);
  const person = users.data?.find((user) => user.id === ownerId);
  const title = filter === 'overdue' ? t('taskList.overdue')
    : filter === 'flagged' ? t('taskList.flagged')
      : person ? t('taskList.forPerson', { name: person.name }) : t('taskList.title');
  const range = (key: string, a?: string, b?: string) => (a && b ? t(key, { from: formatDay(a, lang), to: formatDay(b, lang) }) : '');
  const subtitle = [teamText, range('taskList.dueRange', from, to), range('taskList.createdRange', createdFrom, createdTo), range('taskList.doneRange', doneFrom, doneTo)]
    .filter(Boolean).join(' · ');
  const rows = tasks.data ?? [];
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <>
      <ScreenTitle title={title} />
      <Subtitle text={subtitle} />
      {tasks.error && <LoadFailed error={tasks.error} onRetry={() => void tasks.refetch()} />}
      {tasks.data && rows.length === 0 && <EmptyState title={t('taskList.emptyTitle')} body={t('taskList.empty')} action={<BackToDashboard />} />}
      {rows.length > 0 && (
        <ul className="surface overflow-hidden rounded-card py-1">
          <AnimatePresence initial={false}>
            {rows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={(_, thread) => open(row, thread)} showProject />)}
          </AnimatePresence>
        </ul>
      )}
      {taskId && projectId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </>
  );
}

/** A filtered list of tasks or deadlines from all projects. The dashboard opens it; it is not in the navigation (spec 3.1). */
export function TaskListScreen() {
  const [params] = useSearchParams();
  if (params.get('mode') === 'deadlines') return <DeadlineList from={dayParam(params.get('from'))} to={dayParam(params.get('to'))} />;
  return <TaskResults />;
}
