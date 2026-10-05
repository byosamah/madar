import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useMeeting } from '../../app/meeting';
import { useCall } from '../../app/runtime';
import { Age } from '../../components/Age';
import { Avatar } from '../../components/Avatar';
import { NoLeadMark } from '../../components/NoLeadMark';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { RichText } from '../../components/RichText';
import { ProjectSign } from '../../components/ProjectSign';
import { signOfProject, StatusSign } from '../../components/StatusSign';
import { diffDays, formatDay, todayISO } from '../../lib/dates';
import { dueText, dueWord, wordForDays } from '../../lib/due';
import { needsAttention } from '../../lib/overview';
import { compareTasks } from '../../lib/stageFlow';
import { ChainsPanel } from './meeting/ChainsPanel';
import { ClientItemsPanel } from './meeting/ClientItemsPanel';
import { DecisionsPanel } from './meeting/DecisionsPanel';
import { DrawingsStrip } from './meeting/DrawingsStrip';
import { MeetingPayments } from './meeting/MeetingPayments';
import { PeopleStrip } from './meeting/PeopleStrip';
import type { DashboardData } from './Tiles';

type Row = DashboardData['schedule'][number];

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

/**
 * The work of one project that a meeting talks about: what needs attention, and the rest of the work in progress now.
 * A task shows in one place only (owner, 2026-10-02: the ADHD pass): under its first reason, past due before waiting for review
 * before flagged, and never again under In progress. The counts on the timeline use the same lists, so the numbers match.
 */
export function meetingWork(rows: TaskRow[], projectId: string, today: string) {
  const mine = rows.filter((row) => row.project.id === projectId);
  const { pastDue, review, flagged } = needsAttention(mine, today);
  const seen = new Set<string>();
  const once = (list: TaskRow[]) => list.filter((row) => !seen.has(row.task.id) && Boolean(seen.add(row.task.id)));
  const attention = { pastDue: once(pastDue), review: once(review), flagged: once(flagged) };
  const doing = mine.filter((row) => row.task.status === 'in_progress' && !seen.has(row.task.id))
    .sort((a, b) => compareTasks(a.task, b.task));
  return { doing, ...attention };
}

function TaskItem({ row, label, onOpen }: { row: TaskRow; label?: string; onOpen: (row: TaskRow) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const word = dueWord(row.task.dueDate, todayISO(), row.task.status);
  const when = word && row.task.dueDate ? dueText(word, t, lang, row.task.dueDate) : null;
  return (
    <li>
      {/* The whole item is one button: a press opens the task panel over the meeting. */}
      <button type="button" onClick={() => onOpen(row)} className="pressable flex w-full items-center gap-3 rounded-2xl py-2.5 text-start">
        {/* The owner name is in the text below, so the picture stays out of the button name and the name starts with the title. */}
        <span aria-hidden className="shrink-0">{row.owner ? <Avatar user={row.owner} size={36} /> : <NoLeadMark size={36} />}</span>
        <span className="min-w-0 flex-1">
          <bdi className="block truncate text-[19px] font-semibold text-ink">{row.task.title}</bdi>
          <span className="block truncate text-[15px] text-ink-2">
            <bdi>{row.owner ? nameOf(row.owner) : t('lead.noLead')}</bdi>{label && <> · {label}</>}
          </span>
        </span>
        {when && (word?.tone === 'attn' ? <StatusSign state="late">{when}</StatusSign> : <span className="tabular shrink-0 text-[15px] text-ink-2">{when}</span>)}
      </button>
    </li>
  );
}

function Column({ title, empty = '', children, count }: { title: string; empty?: string; children: React.ReactNode; count: number }) {
  return (
    <section aria-label={title} className="panel flex min-w-0 flex-col p-5">
      <h3 className={`${HEADING} flex items-center gap-2`}>
        {title}
        {/* A count of zero is not said. The calm state word below says it (audit 2026-10-03, DSH-9). */}
        {count > 0 && <span className="tabular rounded-full bg-fill px-2 text-[13px] text-ink-2">{count}</span>}
      </h3>
      {count === 0 ? <p className="pt-3 text-[17px] text-ink-2">{empty}</p> : <ul className="hairline pt-1">{children}</ul>}
    </section>
  );
}

/**
 * One project per screen, for a meeting (owner, 2026-10-01): where it stands, the work in progress now with its people,
 * what needs a decision, and what comes next. The arrow keys move between projects in agenda order.
 */
export function MeetingProject({ row, tasks, discussed = false, onOpenTask }: { row: Row; tasks: TaskRow[]; discussed?: boolean; onOpenTask: (taskId: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const today = todayISO();
  const work = meetingWork(tasks, row.project.id, today);
  const mine = tasks.filter((item) => item.project.id === row.project.id);
  const stageIndex = row.stages.findIndex((stage) => stage.id === row.currentStageId);
  const stage = row.stages[stageIndex];
  const next = row.deadlines.filter((deadline) => deadline.date >= today).slice(0, 4);
  const posts = useCall('updates.list', { projectId: row.project.id, filter: 'posts' });
  // A decision of this meeting shows in the Decisions panel, so it is not the latest update too (audit 2026-10-03, DSH-8).
  const startedAt = useMeeting()?.startedAt ?? '';
  const latest = posts.data?.find((item) => item.kind === 'update' && !(item.decision && item.at >= startedAt));
  const attentionCount = work.pastDue.length + work.review.length + work.flagged.length;
  const open = (item: TaskRow) => onOpenTask(item.task.id);
  const stageLeft = stage?.endDate ? diffDays(today, stage.endDate) : null;
  return (
    <article aria-label={row.project.name} className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="panel flex shrink-0 flex-wrap items-center gap-x-6 gap-y-4 p-6">
        <ProjectTile id={row.project.id} mark={row.project.mark} size={64} />
        {/* The header holds who, where and how: the name, the people with open work, and the stage with its state. */}
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-3">
          <div>
            {discussed && <StatusSign state="completed">{t('dashboard.meeting.discussed')}</StatusSign>}
            <h2 dir="auto" className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink [text-wrap:balance]">{row.project.name}</h2>
          </div>
          <PeopleStrip tasks={mine} onOpenTask={onOpenTask} />
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
      {/* One scroll area below the project header, read in the order the meeting talks (owner, 2026-10-02: the ADHD pass).
          The wide side holds what to talk about, the most urgent first: what needs attention, the client items, the work in
          progress, and what waits for what. The narrow side holds the one place to write, then the facts. The drawings close it.
          Nothing is pinned under the columns, so they keep their full height on every screen and in Big screen. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <div className="grid shrink-0 content-start items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Column title={t('overview.attention')} empty={t('overview.allClear')} count={attentionCount}>
              {work.pastDue.map((item) => <TaskItem key={item.task.id} row={item} label={t('overview.groups.pastDue')} onOpen={open} />)}
              {work.review.map((item) => <TaskItem key={item.task.id} row={item} label={t('overview.groups.review')} onOpen={open} />)}
              {work.flagged.map((item) => <TaskItem key={item.task.id} row={item} label={t('overview.groups.flagged')} onOpen={open} />)}
            </Column>
            <ClientItemsPanel projectId={row.project.id} />
            {/* An empty display panel hides (owner, 2026-10-02). The late work in progress already shows above. */}
            {work.doing.length > 0 && (
              <Column title={t('dashboard.meeting.inProgress')} count={work.doing.length}>
                {work.doing.map((item) => <TaskItem key={item.task.id} row={item} onOpen={open} />)}
              </Column>
            )}
            <ChainsPanel tasks={mine} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <DecisionsPanel projectId={row.project.id} />
            {/* An empty display panel hides (owner, 2026-10-02; audit 2026-10-03, DSH-9). */}
            {next.length > 0 && (
              <section aria-label={t('overview.comingUp')} className="panel flex flex-col gap-2 p-5">
                <h3 className={HEADING}>{t('overview.comingUp')}</h3>
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
              </section>
            )}
            {latest && latest.kind === 'update' && (
              <section aria-label={t('overview.latest')} className="panel flex flex-col gap-2 p-5">
                <h3 className={HEADING}>{t('overview.latest')}</h3>
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-[15px] text-ink-2">
                    <Avatar user={latest.author} size={24} />
                    <bdi className="font-semibold text-ink">{nameOf(latest.author)}</bdi>
                    <Age stamp={latest.at} />
                  </span>
                  <div dir="auto" className="line-clamp-5 text-[17px] text-ink"><RichText body={latest.body} /></div>
                </div>
              </section>
            )}
            <MeetingPayments projectId={row.project.id} />
          </div>
        </div>
        <DrawingsStrip projectId={row.project.id} />
      </div>
    </article>
  );
}
