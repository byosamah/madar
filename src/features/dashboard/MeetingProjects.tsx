import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Age } from '../../components/Age';
import { Avatar } from '../../components/Avatar';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { RichText } from '../../components/RichText';
import { ProjectSign } from '../../components/ProjectSign';
import { signOfProject, StatusSign } from '../../components/StatusSign';
import { diffDays, formatDay, todayISO } from '../../lib/dates';
import { dueText, dueWord, wordForDays } from '../../lib/due';
import { needsAttention } from '../../lib/overview';
import { compareTasks } from '../../lib/stageFlow';
import type { DashboardData } from './Tiles';

type Row = DashboardData['schedule'][number];

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

/** The work of one project that a meeting talks about: in progress now, and what needs attention. */
export function meetingWork(rows: TaskRow[], projectId: string, today: string) {
  const mine = rows.filter((row) => row.project.id === projectId);
  const doing = mine.filter((row) => row.task.status === 'in_progress')
    .sort((a, b) => compareTasks(a.task, b.task));
  return { doing, ...needsAttention(mine, today) };
}

function TaskItem({ row, label }: { row: TaskRow; label?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const word = dueWord(row.task.dueDate, todayISO(), row.task.status);
  const when = word && row.task.dueDate ? dueText(word, t, lang, row.task.dueDate) : null;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Avatar user={row.owner} size={36} />
      <span className="min-w-0 flex-1">
        <bdi className="block truncate text-[19px] font-semibold text-ink">{row.task.title}</bdi>
        <span className="block truncate text-[15px] text-ink-2">
          <bdi>{row.owner.name}</bdi>{label && <> · {label}</>}
        </span>
      </span>
      {when && (word?.tone === 'attn' ? <StatusSign state="late">{when}</StatusSign> : <span className="tabular shrink-0 text-[15px] text-ink-2">{when}</span>)}
    </li>
  );
}

function Column({ title, empty, children, count }: { title: string; empty: string; children: React.ReactNode; count: number }) {
  return (
    <section aria-label={title} className="panel flex min-w-0 flex-col p-5">
      <h3 className={`${HEADING} flex items-center gap-2`}>
        {title}
        <span className="tabular rounded-full bg-fill px-2 text-[13px] text-ink-2">{count}</span>
      </h3>
      {count === 0 ? <p className="pt-3 text-[17px] text-ink-2">{empty}</p> : <ul className="hairline pt-1">{children}</ul>}
    </section>
  );
}

/**
 * One project per screen, for a meeting (owner, 2026-10-01): where it stands, the work in progress now with its people,
 * what needs a decision, and what comes next. The arrow keys move between projects.
 */
export function MeetingProject({ row, tasks, index, total }: { row: Row; tasks: TaskRow[]; index: number; total: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const today = todayISO();
  const work = meetingWork(tasks, row.project.id, today);
  const stageIndex = row.stages.findIndex((stage) => stage.id === row.currentStageId);
  const stage = row.stages[stageIndex];
  const next = row.deadlines.filter((deadline) => deadline.date >= today).slice(0, 4);
  const posts = useCall('updates.list', { projectId: row.project.id, filter: 'posts' });
  const latest = posts.data?.find((item) => item.kind === 'update');
  const attentionCount = work.pastDue.length + work.review.length + work.flagged.length;
  const stageLeft = stage?.endDate ? diffDays(today, stage.endDate) : null;
  return (
    <article aria-label={row.project.name} className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="panel flex flex-wrap items-center gap-x-6 gap-y-4 p-6">
        <ProjectTile id={row.project.id} mark={row.project.mark} size={64} />
        <div className="min-w-0 flex-1 basis-80">
          <p className="text-[15px] font-medium text-ink-2">{t('dashboard.meeting.projectOf', { n: index + 1, total })}</p>
          <h2 dir="auto" className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink [text-wrap:balance]">{row.project.name}</h2>
        </div>
        <div className="flex min-w-72 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[19px] font-semibold text-ink">
              <bdi>{stage?.name ?? ''}</bdi>
              <span className="text-ink-2"> · {t('projects.stageCount', { n: stageIndex + 1, total: row.stages.length })}</span>
            </span>
            {row.pause
              ? <ProjectSign project={{ status: 'on_hold', pause: row.pause }} staleDays={row.pause.staleDays} />
              : <StatusSign state={row.health}>{t(`health.${row.health}`)}</StatusSign>}
          </div>
          <ProgressLine index={stageIndex} total={row.stages.length} size="lg" tone={signOfProject({ project: { status: row.pause ? 'on_hold' : 'active', pause: row.pause }, health: row.pause ? null : { value: row.health }, staleDays: row.pause?.staleDays ?? null })} label={t('projects.stageCount', { n: stageIndex + 1, total: row.stages.length })} />
          {stage?.endDate && stageLeft !== null && (
            <span className={`tabular text-[15px] ${stageLeft < 0 ? 'text-attn' : 'text-ink-2'}`}>
              {t('overview.stageEndLabel')}: {formatDay(stage.endDate, lang)}
            </span>
          )}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 content-start items-start gap-5 overflow-y-auto lg:grid-cols-3">
        <Column title={t('dashboard.meeting.inProgress')} empty={t('dashboard.meeting.nothingInProgress')} count={work.doing.length}>
          {work.doing.map((item) => <TaskItem key={item.task.id} row={item} />)}
        </Column>
        <Column title={t('overview.attention')} empty={t('overview.allClear')} count={attentionCount}>
          {work.pastDue.map((item) => <TaskItem key={`p-${item.task.id}`} row={item} label={t('overview.groups.pastDue')} />)}
          {work.review.map((item) => <TaskItem key={`r-${item.task.id}`} row={item} label={t('overview.groups.review')} />)}
          {work.flagged.map((item) => <TaskItem key={`f-${item.task.id}`} row={item} label={t('overview.groups.flagged')} />)}
        </Column>
        <div className="flex min-h-0 min-w-0 flex-col gap-5">
          <section aria-label={t('overview.comingUp')} className="panel flex flex-col gap-2 p-5">
            <h3 className={HEADING}>{t('overview.comingUp')}</h3>
            {next.length === 0 ? <p className="text-[17px] text-ink-2">{t('overview.noDeadlines')}</p> : (
              <ul className="flex flex-col gap-2 pt-1">
                {next.map((deadline) => {
                  const word = wordForDays(diffDays(today, deadline.date));
                  return (
                    <li key={deadline.id} className="flex items-baseline justify-between gap-3">
                      <bdi className="min-w-0 truncate text-[17px] text-ink">{deadline.name}</bdi>
                      <span className="tabular shrink-0 text-[15px] text-ink-2">{word.key === 'dueOn' ? formatDay(deadline.date, lang) : dueText(word, t, lang, deadline.date)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section aria-label={t('overview.latest')} className="panel flex min-h-0 flex-col gap-2 p-5">
            <h3 className={HEADING}>{t('overview.latest')}</h3>
            {posts.data && !latest && <p className="text-[17px] text-ink-2">{t('overview.noPosts')}</p>}
            {latest && latest.kind === 'update' && (
              <div className="flex min-h-0 flex-col gap-2">
                <span className="flex items-center gap-2 text-[15px] text-ink-2">
                  <Avatar user={latest.author} size={24} />
                  <bdi className="font-semibold text-ink">{latest.author.name}</bdi>
                  <Age stamp={latest.at} />
                </span>
                <div dir="auto" className="line-clamp-5 text-[17px] text-ink"><RichText body={latest.body} /></div>
              </div>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}
