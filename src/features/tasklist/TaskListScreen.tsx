import { AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay, todayISO } from '../../lib/dates';
import { clientName } from '../../lib/clientName';
import { clientParam, dayParam, oneOf, teamParam, userParam } from '../../lib/params';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { NextDeadlineLabel } from '../projects/ProjectCard';
import { projectKey } from '../../lib/projectCode';

/** no_lead and no_date: the data gaps that the Dashboard opens for the Admin (owner, 2026-10-06). */
const FILTERS = ['all', 'overdue', 'flagged', 'no_lead', 'no_date'] as const;

/**
 * The Dashboard filters in the link: the office team, the leader and the client. The Dashboard sends them, so the list holds the
 * tasks it counted, and the subtitle names each one (audit 2026-10-03, V-37a; owner, 2026-10-06, item 3).
 */
function useScope(): { teamId?: string; leaderId?: string; clientId?: string; scopeText: string } {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const [params] = useSearchParams();
  const teamId = teamParam(params.get('team'));
  const leaderId = userParam(params.get('leader'));
  const clientId = clientParam(params.get('client'));
  const teams = useCall('teams.list', {}, { enabled: teamId !== undefined });
  const users = useCall('users.list', { includeInactive: true }, { enabled: leaderId !== undefined });
  const clients = useCall('clients.list', {}, { enabled: clientId !== undefined });
  const team = teams.data?.find((item) => item.id === teamId);
  const leader = users.data?.find((user) => user.id === leaderId);
  const client = clients.data?.find((item) => item.id === clientId);
  const scopeText = [
    team ? t('taskList.team', { name: team.name }) : '',
    leader ? t('taskList.leader', { name: nameOf(leader) }) : '',
    client ? t('taskList.client', { name: clientName(client, lang) }) : '',
  ].filter(Boolean).join(' · ');
  return { teamId, leaderId, clientId, scopeText };
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
  const { teamId, leaderId, clientId, scopeText } = useScope();
  const deadlines = useCall('deadlines.list', { from, to, teamId, leaderId, clientId });
  const rows = deadlines.data ?? [];
  const range = from && to ? t('taskList.dateRange', { from: formatDay(from, lang), to: formatDay(to, lang) }) : '';
  return (
    <>
      <ScreenTitle title={t('taskList.deadlinesTitle')} />
      <Subtitle text={[scopeText, range].filter(Boolean).join(' · ')} />
      {deadlines.error && <LoadFailed error={deadlines.error} onRetry={() => void deadlines.refetch()} />}
      {/* The list draws only with data, so a failed or loading list shows no empty panel; an empty list says where to go (audit PER-18). */}
      {deadlines.data && rows.length === 0 && <EmptyState title={t('taskList.emptyTitle')} body={t('taskList.emptyDeadlines')} action={<BackToDashboard />} />}
      {rows.length > 0 && (
        <ul className="surface flex flex-col rounded-card p-2">
          {rows.map((row) => (
            <li key={row.deadline.id}>
              <Link to={`/projects/${row.project.id}?tab=schedule`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2 hover:bg-fill">
                <span className="min-w-0 flex-1">
                  <span className="tabular block text-footnote text-label-2">{projectKey(row.project.code)} · <bdi>{row.project.name}</bdi></span>
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
  const nameOf = usePersonName();
  const [params, setParams] = useSearchParams();
  const filter = oneOf(params.get('filter'), FILTERS, 'all');
  const ownerId = userParam(params.get('owner'));
  // The work of a person, from a week cell of the Dashboard: their open tasks and the tasks they review (owner, 2026-10-06).
  const workOf = userParam(params.get('work'));
  const from = dayParam(params.get('from'));
  const to = dayParam(params.get('to'));
  const createdFrom = dayParam(params.get('createdFrom'));
  const createdTo = dayParam(params.get('createdTo'));
  const doneFrom = dayParam(params.get('doneFrom'));
  const doneTo = dayParam(params.get('doneTo'));
  const { teamId, leaderId, clientId, scopeText } = useScope();
  const users = useCall('users.list', { includeInactive: true });
  // One session.get for the whole list. Each row takes the person from here.
  const me = useCall('session.get', {}).data?.authority;
  const tasks = useCall('tasks.list', {
    filter, ownerId, workOf, teamId, leaderId, clientId, dueFrom: from, dueTo: to, createdFrom, createdTo, doneFrom, doneTo, // A created or done range counts finished tasks too, the same as the dashboard number that opens it.
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
  const person = users.data?.find((user) => user.id === (ownerId ?? workOf));
  const title = filter === 'overdue' ? (person ? t('taskList.overdueOf', { name: nameOf(person) }) : t('taskList.overdue'))
    : filter === 'flagged' ? t('taskList.flagged')
      : filter === 'no_lead' ? t('taskList.noLead')
        : filter === 'no_date' ? t('taskList.noDate')
          : person ? t('taskList.forPerson', { name: nameOf(person) }) : t('taskList.title');
  // A task in review counts for its reviewer in a range that holds today, so the subtitle says the list has them.
  const today = todayISO();
  const reviews = workOf !== undefined && (!from || from <= today) && (!to || today <= to) ? t('taskList.withReviews') : '';
  const range = (key: string, a?: string, b?: string) => (a && b ? t(key, { from: formatDay(a, lang), to: formatDay(b, lang) }) : '');
  const subtitle = [scopeText, range('taskList.dueRange', from, to), reviews, range('taskList.createdRange', createdFrom, createdTo), range('taskList.doneRange', doneFrom, doneTo)]
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
            {rows.map((row) => <TaskRowItem key={row.task.id} row={row} me={me} onOpen={(_, thread) => open(row, thread)} showProject />)}
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
