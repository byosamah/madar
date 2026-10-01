import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { TaskRow } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { LoadFailed } from '../../../components/LoadFailed';
import { ProgressLine } from '../../../components/ProgressLine';
import { RichText } from '../../../components/RichText';
import { StateWord } from '../../../components/StateWord';
import { StatusSign, signOfStatus } from '../../../components/StatusSign';
import { formatDay, todayISO } from '../../../lib/dates';
import { dueText, dueWord, wordForDays } from '../../../lib/due';
import { counted } from '../../../lib/grammar';
import { currentWork, needsAttention, stageStanding } from '../../../lib/overview';
import { projectHue, stageProgress } from '../../../lib/projectColor';
import type { TabProps } from '../tabs';
import { TaskSheet } from '../tasks/TaskSheet';
import { AboutPanel } from './AboutPanel';

const HEADING = 'text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2';

/** One task as a short line: title, owner, gentle due word. A press opens the task panel. */
function TaskLine({ row, onOpen, showOwner = true }: { row: TaskRow; onOpen: (id: string) => void; showOwner?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const word = dueWord(row.task.dueDate, todayISO(), row.task.status);
  const when = word && row.task.dueDate ? dueText(word, t, lang, row.task.dueDate) : null;
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.task.id)} className="pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-fill/50">
        <span className="min-w-0 flex-1">
          <bdi className="block truncate text-subheadline font-medium text-ink">{row.task.title}</bdi>
          {showOwner && <bdi className="block truncate text-footnote text-ink-2">{row.owner.name}</bdi>}
        </span>
        {when && (word?.tone === 'attn' ? <StateWord tone="attn">{when}</StateWord> : <span className="tabular shrink-0 text-footnote text-ink-2">{when}</span>)}
      </button>
    </li>
  );
}

/** Where the project stands: the stage, how far the stage is, the stage's end and the health (owner's request, 2026-10-01). */
function Standing({ detail, rows }: TabProps & { rows: TaskRow[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project, currentStage, stages, health, healthSetBy } = detail;
  const index = stages.findIndex((stage) => stage.id === currentStage.id);
  const standing = stageStanding(rows, currentStage, todayISO());
  const late = standing.daysLeft !== null && standing.daysLeft < 0;
  return (
    <section aria-labelledby="overview-standing" className="panel flex flex-col gap-4 p-5">
      <h2 id="overview-standing" className={HEADING}>{t('overview.standing')}</h2>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-footnote text-ink-2">{t('projects.stageCount', { n: index + 1, total: stages.length })}</p>
          <p dir="auto" className="text-section text-ink">{currentStage.name}</p>
        </div>
        {health ? <StatusSign state={health.value}>{t(`health.${health.value}`)}</StatusSign> : <StatusSign state={signOfStatus(project.status)}>{t(`status.${project.status}`)}</StatusSign>}
      </div>
      <ProgressLine value={stageProgress(detail)} hue={projectHue(project.id)} label={t('projects.stageCount', { n: index + 1, total: stages.length })} className="h-1.5" />
      <dl className="grid gap-x-6 gap-y-2 text-subheadline sm:grid-cols-2">
        <div>
          <dt className="text-footnote text-ink-2">{t('overview.stageTasksLabel')}</dt>
          <dd className="tabular text-ink">{t('overview.stageTasks', { done: standing.done, total: standing.total })}</dd>
        </div>
        <div>
          <dt className="text-footnote text-ink-2">{t('overview.stageEndLabel')}</dt>
          <dd className={`tabular ${late ? 'text-attn' : 'text-ink'}`}>
            {standing.daysLeft === null || !currentStage.endDate
              ? t('project.noDates')
              : `${formatDay(currentStage.endDate, lang)} · ${late ? counted(t, 'overview.stageLate', -standing.daysLeft) : standing.daysLeft === 0 ? t('due.today') : counted(t, 'overview.stageLeft', standing.daysLeft)}`}
          </dd>
        </div>
      </dl>
      {health?.overridden && health.reason && (
        <p className="rounded-xl bg-fill px-3 py-2 text-footnote text-ink-2">
          <bdi>{healthSetBy ? t('overview.healthNote', { name: healthSetBy.name }) : ''}</bdi> <bdi className="text-ink">{health.reason}</bdi>
        </p>
      )}
    </section>
  );
}

function Attention({ rows, onOpen }: { rows: TaskRow[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const groups = needsAttention(rows, todayISO());
  const parts = [
    { key: 'pastDue', items: groups.pastDue },
    { key: 'review', items: groups.review },
    { key: 'flagged', items: groups.flagged },
  ].filter((part) => part.items.length > 0);
  return (
    <section aria-labelledby="overview-attention" className="panel flex flex-col gap-3 p-5">
      <h2 id="overview-attention" className={HEADING}>{t('overview.attention')}</h2>
      {parts.length === 0 && <p className="text-subheadline text-ink-2">{t('overview.allClear')}</p>}
      {parts.map((part) => (
        <div key={part.key} className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-subheadline font-semibold text-ink">
            {t(`overview.groups.${part.key}`)}
            <span className="tabular rounded-full bg-fill px-2 text-caption font-semibold text-ink-2">{part.items.length}</span>
          </h3>
          <ul className="-mx-2 flex flex-col">
            {part.items.slice(0, 3).map((row) => <TaskLine key={row.task.id} row={row} onOpen={onOpen} />)}
          </ul>
          {part.items.length > 3 && <p className="text-footnote text-ink-2">{counted(t, 'overview.more', part.items.length - 3)}</p>}
        </div>
      ))}
    </section>
  );
}

function People({ detail, rows, onOpen }: TabProps & { rows: TaskRow[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="overview-people" className="panel flex flex-col gap-1 p-5">
      <h2 id="overview-people" className={`${HEADING} pb-2`}>{t('overview.people')}</h2>
      <ul className="hairline flex flex-col">
        {detail.members.map((member) => {
          const work = currentWork(rows, member.user.id);
          return (
            <li key={member.user.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
                <Avatar user={member.user} size={32} />
                <span className="min-w-0">
                  <bdi className="block truncate text-subheadline font-semibold text-ink">{member.user.name}</bdi>
                  <span className="block truncate text-footnote text-ink-2">
                    {member.isLeader ? t('team.leader') : member.discipline} · {counted(t, 'overview.openTasks', work.open)}
                  </span>
                </span>
              </span>
              {work.now
                ? <ul className="-mx-2 min-w-0 flex-1"><TaskLine row={work.now} onOpen={onOpen} showOwner={false} /></ul>
                : <p className="text-subheadline text-ink-2 sm:flex-1">{t('overview.noOpen')}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ComingUp({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const today = todayISO();
  const next = detail.deadlines.filter((deadline) => deadline.date >= today).slice(0, 4);
  return (
    <section aria-labelledby="overview-coming" className="panel flex flex-col gap-2 p-5">
      <h2 id="overview-coming" className={HEADING}>{t('overview.comingUp')}</h2>
      {next.length === 0 ? <p className="text-subheadline text-ink-2">{t('overview.noDeadlines')}</p> : (
        <ul className="flex flex-col gap-2">
          {next.map((deadline) => {
            const word = wordForDays(Math.round((Date.parse(deadline.date) - Date.parse(today)) / 86_400_000));
            return (
              <li key={deadline.id} className="flex items-baseline justify-between gap-3 text-subheadline">
                <bdi className="min-w-0 truncate text-ink">{deadline.name}</bdi>
                <span className="tabular shrink-0 text-ink-2">{word.key === 'dueOn' ? formatDay(deadline.date, lang) : dueText(word, t, lang, deadline.date)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LatestUpdate({ detail }: TabProps) {
  const { t } = useTranslation();
  const posts = useCall('updates.list', { projectId: detail.project.id, filter: 'posts' });
  const latest = posts.data?.find((item) => item.kind === 'update');
  return (
    <section aria-labelledby="overview-latest" className="panel flex flex-col gap-3 p-5">
      <h2 id="overview-latest" className={HEADING}>{t('overview.latest')}</h2>
      {posts.data && !latest && <p className="text-subheadline text-ink-2">{t('overview.noPosts')}</p>}
      {latest && latest.kind === 'update' && (
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <Avatar user={latest.author} size={24} />
            <bdi className="truncate text-footnote font-semibold text-ink">{latest.author.name}</bdi>
            {latest.author.kind === 'agent' && <AgentLabel />}
            <span className="text-footnote text-ink-2"><Age stamp={latest.at} /></span>
          </span>
          <div dir="auto" className="line-clamp-4 text-subheadline text-ink"><RichText body={latest.body} /></div>
        </div>
      )}
      <Link to="?tab=activity" className="flex min-h-11 items-center self-start text-subheadline font-semibold text-link">{t('overview.seeActivity')}</Link>
    </section>
  );
}

/**
 * The project at a glance (owner's request, 2026-10-01): where it stands, what needs attention,
 * what each person works on now, what comes next. The log of every change lives in Activity.
 */
export function OverviewTab({ detail }: TabProps) {
  const [params, setParams] = useSearchParams();
  const tasks = useCall('tasks.list', { projectId: detail.project.id, activeProjectsOnly: false });
  const open = useCallback((taskId: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', taskId);
    return next;
  }), [setParams]);
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    return next;
  }), [setParams]);
  if (tasks.error) return <LoadFailed error={tasks.error} onRetry={() => void tasks.refetch()} />;
  const rows = tasks.data ?? [];
  const taskId = params.get('task');
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Standing detail={detail} rows={rows} />
        <Attention rows={rows} onOpen={open} />
        <People detail={detail} rows={rows} onOpen={open} />
      </div>
      <aside className="flex min-w-0 flex-col gap-5">
        <ComingUp detail={detail} />
        <LatestUpdate detail={detail} />
        <AboutPanel detail={detail} />
      </aside>
      {taskId && <TaskSheet key={taskId} taskId={taskId} detail={detail} onClose={close} />}
    </div>
  );
}
