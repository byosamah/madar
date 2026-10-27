import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { FeedItem, TaskRow, TrackerRow } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { PRIVATE } from '../../../app/privateMark';
import { useIsPhone } from '../../../app/useIsPhone';
import { usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { LoadFailed } from '../../../components/LoadFailed';
import { RichText } from '../../../components/RichText';
import { ProjectSign } from '../../../components/ProjectSign';
import { StatusSign } from '../../../components/StatusSign';
import { diffDays, formatDay, stampDay, todayISO } from '../../../lib/dates';
import { dueText, dueWord, wordForDays } from '../../../lib/due';
import { actorContext, counted } from '../../../lib/grammar';
import { currentWork, needsAttention, stageStanding } from '../../../lib/overview';
import { currentStageIndex } from '../../../lib/stageFlow';
import { PAYMENT_PANEL, TASK_PANEL, usePanelLink } from '../panelLink';
import { SECTION_LABEL } from '../sectionLabel';
import { StageProgress } from '../StageProgress';
import type { TabProps } from '../tabs';
import { TaskSheet } from '../tasks/TaskSheet';
import { Loop } from '../tracker/OpenLoops';
import { amountText, PaymentsPanel } from '../payments/PaymentsPanel';
import { NextDeadlineLabel } from '../../projects/ProjectCard';
import { AboutPanel } from './AboutPanel';
import { Composer } from './Composer';
import { ProjectMeetings } from './ProjectMeetings';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CornerUpLeftIcon } from '../../../components/icons/animated/corner-up-left';

/** One task as a short line: title, owner, gentle due word. A press opens the task panel. */
function TaskLine({ row, onOpen, showOwner = true }: { row: TaskRow; onOpen: (id: string) => void; showOwner?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const word = dueWord(row.task.dueDate, todayISO(), row.task.status);
  const when = word && row.task.dueDate ? dueText(word, t, lang, row.task.dueDate) : null;
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.task.id)} className="pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-fill/50">
        <span className="min-w-0 flex-1">
          <bdi className="block truncate text-subheadline font-medium text-ink">{row.task.title}</bdi>
          {showOwner && <bdi className="block truncate text-footnote text-ink-2">{row.owner ? nameOf(row.owner) : t('lead.noLead')}</bdi>}
        </span>
        {when && (word?.tone === 'attn' ? <StatusSign state="late" wrap>{when}</StatusSign> : <span className="tabular shrink-0 text-footnote text-ink-2">{when}</span>)}
      </button>
    </li>
  );
}

/** Where the project stands: the stage, how far the stage is, the stage's end and the health (owner's request, 2026-10-01). */
function Standing({ detail, rows, phone = false }: TabProps & { rows: TaskRow[]; phone?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const { project, currentStage, stages, health, healthSetBy } = detail;
  const index = currentStageIndex(stages, currentStage);
  const standing = stageStanding(rows, currentStage, todayISO());
  // A stage end date never makes a continuous project late (fbk_069): the date shows plain, with no count of days.
  const late = !project.continuous && standing.daysLeft !== null && standing.daysLeft < 0;
  return (
    <section aria-labelledby="overview-standing" className="panel flex flex-col gap-4 p-5">
      <h2 id="overview-standing" className={SECTION_LABEL}>{t('overview.standing')}</h2>
      {/* A phone shows the stage name, the count and the steps in the header, so this panel keeps the facts only. */}
      {!phone && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-footnote text-ink-2">{t('projects.stageCount', { n: index + 1, total: stages.length })}</p>
              <p dir="auto" className="text-section text-ink">{currentStage.name}</p>
            </div>
            {health ? <StatusSign state={health.value}>{t(`health.${health.value}`)}</StatusSign> : <ProjectSign project={project} staleDays={detail.staleDays} />}
          </div>
          <StageProgress detail={detail} size="md" />
        </>
      )}
      {project.stageBack && project.stageBack.toStageId === currentStage.id && (
        // Why the project went back a stage, until it moves forward again (colleague comment 12).
        <p className="flex items-start gap-2 text-subheadline text-ink-2">
          <AnimatedIcon icon={CornerUpLeftIcon} size={16} className="mt-0.5 shrink-0 rtl:-scale-x-100" aria-hidden />
          <span dir="auto">
            {t('overview.movedBack', {
              stage: stages.find((stage) => stage.id === project.stageBack!.fromStageId)?.name ?? '',
              date: formatDay(stampDay(project.stageBack.at), lang),
              reason: project.stageBack.reason,
            })}
          </span>
        </p>
      )}
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
              : project.continuous ? formatDay(currentStage.endDate, lang)
              : `${formatDay(currentStage.endDate, lang)} · ${late ? counted(t, 'overview.stageLate', -standing.daysLeft) : standing.daysLeft === 0 ? t('due.today') : counted(t, 'overview.stageLeft', standing.daysLeft)}`}
          </dd>
        </div>
        {phone && detail.nextDeadline && (
          <div>
            <dt className="text-footnote text-ink-2">{t('phoneProject.overview.nextDeadline')}</dt>
            <dd><NextDeadlineLabel deadline={detail.nextDeadline} /></dd>
          </div>
        )}
      </dl>
      {phone && !detail.nextDeadline && (project.continuous || !detail.stageEnd) && <p className="text-footnote text-ink-2">{t(project.continuous ? 'projects.continuous' : 'projects.noDeadline')}</p>}
      {health?.overridden && health.reason && (
        <p className="rounded-xl bg-fill px-3 py-2 text-footnote text-ink-2">
          <bdi>{healthSetBy ? t('overview.healthNote', { name: nameOf(healthSetBy), context: actorContext(healthSetBy) }) : ''}</bdi> <bdi className="text-ink">{health.reason}</bdi>
        </p>
      )}
    </section>
  );
}

/** The title of a group in Attention: its name and how many items it holds. */
function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="flex items-center gap-2 text-subheadline font-semibold text-ink">
      {label}
      <span className="tabular rounded-full bg-fill px-2 text-caption font-semibold text-ink-2">{count}</span>
    </h3>
  );
}

function Attention({ projectId, rows, tracker, onOpen, seesPayments }: { projectId: string; rows: TaskRow[]; tracker: TrackerRow[] | undefined; onOpen: (id: string) => void; seesPayments: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [, setParams] = useSearchParams();
  const groups = needsAttention(rows, todayISO());
  // What the office waits for from the client (a land survey, a soil report), from the Tracker (colleague comment 6).
  const waiting = (tracker ?? []).filter((row) => row.entry.waiting === 'client');
  // Payments that are overdue or fall due within a week. Only the people who handle payments ask for them (colleague comment 6).
  const payments = useCall('payments.list', { projectId }, { enabled: seesPayments });
  const awaiting = (payments.data ?? []).filter((row) => row.status !== 'received' && row.dueInDays <= 7);
  const payment = usePanelLink(PAYMENT_PANEL);
  const toPayment = (id: string) => payment.open({ payment: id });
  // The row opens the entry itself on the Tracker tab, not only the tab (audit 2026-10-03, PRJ-19).
  const toTracker = (entryId: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('tab', 'tracker');
    next.set('entry', entryId);
    return next;
  });
  const parts = [
    { key: 'pastDue', items: groups.pastDue },
    { key: 'review', items: groups.review },
    { key: 'flagged', items: groups.flagged },
  ].filter((part) => part.items.length > 0);
  return (
    <section aria-labelledby="overview-attention" className="panel flex flex-col gap-3 p-5">
      <h2 id="overview-attention" className={SECTION_LABEL}>{t('overview.attention')}</h2>
      {parts.length === 0 && waiting.length === 0 && awaiting.length === 0 && <p className="text-subheadline text-ink-2">{t('overview.allClear')}</p>}
      {parts.map((part) => (
        <div key={part.key} className="flex flex-col gap-1">
          <GroupHeading label={t(`overview.groups.${part.key}`)} count={part.items.length} />
          <ul className="-mx-2 flex flex-col">
            {part.items.slice(0, 3).map((row) => <TaskLine key={row.task.id} row={row} onOpen={onOpen} />)}
          </ul>
          {part.items.length > 3 && <p className="text-footnote text-ink-2">{counted(t, 'overview.more', part.items.length - 3)}</p>}
        </div>
      ))}
      {awaiting.length > 0 && (
        <div className="flex flex-col gap-1">
          <GroupHeading label={t('overview.groups.payment')} count={awaiting.length} />
          <ul className="-mx-2 flex flex-col">
            {awaiting.map((row) => {
              const word = wordForDays(row.dueInDays);
              return (
                <li key={row.payment.id}>
                  <button type="button" onClick={() => toPayment(row.payment.id)} className="pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-fill/50">
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate text-subheadline font-medium text-ink">{row.payment.name}</bdi>
                      <span className={`${PRIVATE} tabular block text-footnote text-ink-2`}>{amountText(t, lang, row.payment.amount)}</span>
                    </span>
                    {word.tone === 'attn'
                      ? <StatusSign state="late">{dueText(word, t, lang, row.payment.dueDate)}</StatusSign>
                      : <span className="tabular shrink-0 text-footnote text-ink-2">{dueText(word, t, lang, row.payment.dueDate)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="flex flex-col gap-1">
          <GroupHeading label={t('tracker.waitingClient')} count={waiting.length} />
          <ul className="flex flex-col">
            {waiting.map((row) => <Loop key={row.entry.id} row={row} onOpen={() => toTracker(row.entry.id)} compact />)}
          </ul>
        </div>
      )}
    </section>
  );
}

function People({ detail, rows, onOpen }: TabProps & { rows: TaskRow[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  return (
    <section aria-labelledby="overview-people" className="panel flex flex-col gap-1 p-5">
      <h2 id="overview-people" className={`${SECTION_LABEL} pb-2`}>{t('overview.people')}</h2>
      <ul className="hairline flex flex-col">
        {detail.members.map((member) => {
          const work = currentWork(rows, member.user.id);
          return (
            <li key={member.user.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
                <Avatar user={member.user} size={32} />
                <span className="min-w-0">
                  <bdi className="block truncate text-subheadline font-semibold text-ink">{nameOf(member.user)}</bdi>
                  <span className="block truncate text-footnote text-ink-2">
                    {/* The discipline is a unit of its own, so in Arabic the count never joins an English name (2026-10-05). */}
                    {member.isLeader ? t('team.leader') : <bdi>{member.discipline}</bdi>} · {counted(t, 'overview.openTasks', work.open)}
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
      <h2 id="overview-coming" className={SECTION_LABEL}>{t('overview.comingUp')}</h2>
      {next.length === 0 ? <p className="text-subheadline text-ink-2">{t('overview.noDeadlines')}</p> : (
        <ul className="flex flex-col gap-2">
          {next.map((deadline) => {
            const word = wordForDays(diffDays(today, deadline.date));
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

/** The author line and the first lines of one post. The Latest update panel and the Updates panel of a phone both draw it. */
function PostGist({ item }: { item: Extract<FeedItem, { kind: 'update' }> }) {
  const nameOf = usePersonName();
  return (
    <>
      <span className="flex items-center gap-2">
        <Avatar user={item.author} size={24} />
        <bdi className="truncate text-footnote font-semibold text-ink">{nameOf(item.author)}</bdi>
        {item.author.kind === 'agent' && <AgentLabel />}
        <span className="text-footnote text-ink-2"><Age stamp={item.at} /></span>
      </span>
      <div dir="auto" className="line-clamp-4 text-subheadline text-ink"><RichText body={item.body} /></div>
    </>
  );
}

function LatestUpdate({ detail }: TabProps) {
  const { t } = useTranslation();
  const posts = useCall('updates.list', { projectId: detail.project.id, filter: 'posts' });
  const latest = posts.data?.find((item) => item.kind === 'update');
  return (
    <section aria-labelledby="overview-latest" className="panel flex flex-col gap-3 p-5">
      <h2 id="overview-latest" className={SECTION_LABEL}>{t('overview.latest')}</h2>
      {posts.data && !latest && <p className="text-subheadline text-ink-2">{t('overview.noPosts')}</p>}
      {latest && latest.kind === 'update' && (
        <div className="flex flex-col gap-2">
          <PostGist item={latest} />
        </div>
      )}
      <Link to="?tab=activity" className="flex min-h-11 items-center self-start text-subheadline font-semibold text-link">{t('overview.seeActivity')}</Link>
    </section>
  );
}

/** The Updates panel of a phone: the post box, then the two newest posts, then the link to the whole feed. */
function UpdatesPanel({ detail }: TabProps) {
  const { t } = useTranslation();
  const posts = useCall('updates.list', { projectId: detail.project.id, filter: 'posts' });
  const newest = (posts.data ?? []).filter((item) => item.kind === 'update').slice(0, 2);
  return (
    <section aria-labelledby="overview-updates" className="panel flex flex-col gap-3 p-5">
      <h2 id="overview-updates" className={SECTION_LABEL}>{t('overview.feed')}</h2>
      {detail.viewerCan.postUpdate ? <Composer detail={detail} compact /> : <p className="text-footnote text-label-2">{t('overview.cannotPost')}</p>}
      {posts.data && newest.length === 0 && <p className="text-subheadline text-ink-2">{t('overview.noPosts')}</p>}
      {newest.length > 0 && (
        <ul className="flex flex-col gap-3">
          {newest.map((item) => item.kind === 'update' && (
            <li key={item.id} data-post className="flex flex-col gap-2">
              <PostGist item={item} />
            </li>
          ))}
        </ul>
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
  const [params] = useSearchParams();
  const phone = useIsPhone();
  const tasks = useCall('tasks.list', { projectId: detail.project.id, activeProjectsOnly: false });
  // The open Tracker rows of Attention load with the tasks, not after them (performance audit 2026-10-07, LIV-1).
  // An internal project has no Tracker (fbk_044): the read stays off.
  const tracker = useCall('tracker.list', { projectId: detail.project.id, openOnly: true }, { enabled: detail.project.kind !== 'internal' });
  // Open adds one history step and Close goes back over it; Close also forgets the Conversation choice (audit 2026-10-03,
  // PRJ-9, PRJ-10, V-36).
  const panel = usePanelLink(TASK_PANEL);
  const open = (taskId: string) => panel.open({ task: taskId });
  if (tasks.error && !tasks.data) return <LoadFailed query={tasks} />;
  const rows = tasks.data ?? [];
  const taskId = params.get('task');
  // Until the tasks arrive, a quiet space stands in, never a false "Nothing needs attention" (audit 2026-10-03, PRJ-18).
  // A phone shows the stage name, the count and the steps in its header, so its Standing panel keeps the facts only.
  const standing = tasks.data ? (
    <>
      <Standing detail={detail} rows={rows} phone={phone} />
      <Attention projectId={detail.project.id} rows={rows} tracker={tracker.data} onOpen={open} seesPayments={detail.viewerCan.payments} />
    </>
  ) : <div aria-busy="true" className="panel min-h-64" />;
  const sheet = taskId && <TaskSheet key={taskId} taskId={taskId} detail={detail} onClose={panel.close} />;
  if (phone) {
    // One column in this order: standing, attention, payments, updates, meetings, coming up, people, about (phone D).
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {standing}
        {detail.viewerCan.payments && <PaymentsPanel projectId={detail.project.id} />}
        <UpdatesPanel detail={detail} />
        <ProjectMeetings detail={detail} />
        <ComingUp detail={detail} />
        {tasks.data && <People detail={detail} rows={rows} onOpen={open} />}
        <AboutPanel detail={detail} />
        {sheet}
      </div>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {standing}
        {detail.viewerCan.payments && <PaymentsPanel projectId={detail.project.id} />}
        {tasks.data && <People detail={detail} rows={rows} onOpen={open} />}
      </div>
      <aside className="flex min-w-0 flex-col gap-5">
        <ComingUp detail={detail} />
        <ProjectMeetings detail={detail} />
        <LatestUpdate detail={detail} />
        <AboutPanel detail={detail} />
      </aside>
      {sheet}
    </div>
  );
}
