import { AnimatePresence, LayoutGroup } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useLang } from '../../app/lang';
import { usePrefetchCall } from '../../app/prefetch';
import { usePersonName } from '../../app/personName';
import { useIsPhone } from '../../app/useIsPhone';
import type { CallOutput } from '../../api/calls';
import type { ProjectSummary, TaskRow } from '../../api/contract/views';
import { useCall, useRuntime } from '../../app/runtime';
import { useStableHandler } from '../../app/useStableHandler';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay, todayISO } from '../../lib/dates';
import { counted } from '../../lib/grammar';
import { comingUp, dayRing, dueByToday, greetingKey, nextForYou, officeHour } from '../../lib/home';
import { useFocusLink } from '../focus/focusLink';
import { todayMeetingsInput } from '../meetings/readInputs';
import { ProjectListRow } from '../projects/ProjectListRow';
import { DayRing } from './DayRing';
import { HomeTaskSheet, warmTaskSheet } from './HomeTaskSheet';
import { MeetingsCard } from './MeetingsCard';
import { NextCard } from './NextCard';
import { PushAskCard } from './PushAskCard';
import { TodayPanel } from './TodayPanel';
import { isLive } from '../../lib/overview';
import { readRoleHint, writeRoleHint } from './roleHint';
import { WHATS_NEW } from '../../whatsNew/entries';
import { hasNew, readSeen } from '../../whatsNew/seen';

/**
 * Both columns of Home: the greeting, Next for you, Today and Your projects. On a phone (Direction D) it is five blocks in one column,
 * with no project section and no What's new link. It takes only plain props and stable handlers, so a
 * link change that only opens or closes the task panel does not render the rows again (performance audit 2026-10-07, RND-2).
 * "today" and "hour" come from the parent, so a new day or hour still gives a new date, greeting and due words.
 */
const HomeBody = memo(function HomeBody({ session, mine, review, listed, listedError, showLeft, phone, today, hour, onOpen, onFocus, onRetry }: {
  session: CallOutput<'session.get'>; mine: TaskRow[]; review: TaskRow[]; listed: ProjectSummary[] | undefined; listedError: unknown; showLeft: boolean; phone: boolean;
  today: string; hour: number; onOpen: (projectId: string | null, taskId: string, thread?: boolean) => void; onFocus: (taskId: string) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const projects = useMemo(() => listed?.filter((summary) => isLive(summary.project.status)), [listed]);
  const { user } = session;
  const next = nextForYou({ review, mine, today });
  const ring = dayRing(mine, today);
  const todayRows = dueByToday(mine, today);
  // A day with nothing due shows the next tasks with a date in place of the empty line (owner, 2026-10-07).
  const laterRows = todayRows.length === 0 ? comingUp(mine, today) : [];
  const firstName = nameOf(user).split(' ')[0];
  const blocks = (
    <>
      <ScreenTitle title={t(`home.greeting.${greetingKey(hour)}`, { name: firstName })}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span>
            {formatDay(today, lang, 'weekday')}
            {/* One count for today (audit PER-12): the ring when it shows. With no task of mine due, the header names what
                waits, so it never says "1 thing today" above "Nothing is due today" (audit BRW-16). */}
            {ring.total === 0 && review.length > 0 && <> · {counted(t, 'home.reviewsWaiting', review.length)}</>}
            {/* One quiet link while the newest What's new entry is not seen; it goes after the visit (UX audit 2026-10-19, chats-16).
                A phone has it in Me (Direction D). */}
            {!phone && hasNew(WHATS_NEW, readSeen(user.id)) && (
              <> · <Link to="/whats-new" className="text-link hover:underline">{t('whatsNew.seeNew')}</Link></>
            )}
          </span>
          <DayRing done={ring.done} total={ring.total} />
        </span>
      </ScreenTitle>
      <NextCard item={next} onOpen={onOpen} onFocus={onFocus} left={showLeft && ring.total - ring.done > 0 ? ring.total - ring.done : null} />
      <TodayPanel rows={todayRows} later={laterRows} me={session.authority} onOpen={(row, thread) => onOpen(row.project?.id ?? null, row.task.id, thread)} />
      {/* The meetings of today, only when there is one (fbk_022). It reads its own list. */}
      <MeetingsCard />
      {/* The one ask for browser push (owner, 2026-10-09). It sits after Today, so the next step of the day stays first. It has
          its own state and draws nothing for a device that was asked, so it never renders the rows again. */}
      <PushAskCard />
    </>
  );
  // A phone gets the blocks as direct children of the grid. A wrapper with display: contents would hide them from .screen-enter.
  if (phone) return blocks;
  return (
    <>
      <div className="flex min-w-0 flex-col gap-4">{blocks}</div>
      <section aria-labelledby="your-projects" className="flex min-w-0 flex-col gap-3 md:pt-[4.25rem]">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 id="your-projects" className="text-section text-ink">{t('home.projects')}</h2>
          {projects && <span className="tabular text-subheadline text-ink-2">{counted(t, 'home.projectCount', projects.length)}</span>}
        </div>
        {listedError ? <LoadFailed error={listedError} onRetry={onRetry} /> : null}
        {projects && projects.length === 0 && <p className="panel px-5 py-4 text-subheadline text-ink-2">{t('home.noProjects')}</p>}
        {projects && projects.length > 0 && (
          <LayoutGroup id="home">
            <ul aria-label={t('home.projects')} className="@container panel hairline overflow-hidden">
              <AnimatePresence initial={false}>
                {projects.map((summary) => <ProjectListRow key={summary.project.id} summary={summary} source="home" />)}
              </AnimatePresence>
            </ul>
          </LayoutGroup>
        )}
        <Link to="/projects" className="flex min-h-11 items-center self-start px-1 text-subheadline font-semibold text-link">{t('home.allProjects')}</Link>
      </section>
    </>
  );
});

/** Home (redesign spec 3.2): your day on the start side, your projects on the end side; one column on a phone. */
export function HomeScreen() {
  const [params, setParams] = useSearchParams();
  const focus = useFocusLink();
  const today = todayISO();
  const session = useCall('session.get', {});
  const mine = useCall('tasks.list', { filter: 'mine' });
  const review = useCall('tasks.list', { filter: 'review_for_me' });
  // The Meetings card mounts only after three answers. Its read starts now, under its key, so it goes in the first request (DF-6).
  const prefetch = usePrefetchCall();
  useEffect(() => prefetch('meetings.list', todayMeetingsInput(today)), [prefetch, today]);
  // The Admin sees every active project; anyone else sees the projects they lead or work on, the paused ones too:
  // a paused or stale project still needs its people, and its row says Paused or Stale (audit PER-13).
  // Before session.get answers, the real build takes the role that this device saw last for this auth user, so the Admin's list
  // goes out in the first request. The session answer then decides (performance audit 2026-10-07, FET-8).
  const { mode, auth } = useRuntime();
  const authUserId = mode === 'remote' ? auth?.userId?.() ?? null : null;
  const [hint] = useState(() => readRoleHint(authUserId));
  const role = session.data?.user.systemRole;
  useEffect(() => {
    if (authUserId && role) writeRoleHint(authUserId, role);
  }, [authUserId, role]);
  const admin = (role ?? hint) === 'admin';
  // A phone has no project list (Direction D), so no read goes out. A turn to landscape starts it.
  const phone = useIsPhone();
  const listed = useCall('projects.list', admin ? { filter: 'all', sort: 'deadline' } : { filter: 'mine', status: 'all', sort: 'deadline' }, { enabled: !phone });
  // An office task has no project, so its link names the task alone (owner, 2026-10-06).
  const open = useStableHandler((projectId: string | null, taskId: string, thread: boolean = false) => setParams({ ...(projectId ? { project: projectId } : {}), task: taskId, ...(thread ? { thread: '1' } : {}) }));
  const startFocus = useStableHandler(focus.open);
  const retryProjects = useStableHandler(() => void listed.refetch());
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    next.delete('thread');
    return next;
  }), [setParams]);
  const [showLeft, setShowLeft] = useState(false);
  const queryClient = useQueryClient();
  // The "Done. N more today." line shows only after the person finishes something here, and fades after 5 seconds (moment 3).
  // The line lives here, so it shows after the to-do sheet over Home closes or stays open (Direction D).
  useEffect(() => {
    let timer = 0;
    const stop = queryClient.getMutationCache().subscribe((event) => {
      const key = event.mutation?.options.mutationKey;
      const finished = key?.[1] === 'tasks.complete' || key?.[1] === 'tasks.approve';
      if (event.type !== 'updated' || !finished || event.action.type !== 'success') return;
      setShowLeft(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShowLeft(false), 5000);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [queryClient]);
  // The task panel loads in its own chunk (FL-1): start it 1 s after Home shows its fresh data, so a press on a task finds it loaded.
  // It waits for the answers (speed follow-up 2026-10-22): a start at the mount sent 21 files on the line of the first request. A stored
  // answer of the Home cache does not count: its read is still on its way (`isFetching`).
  const fresh = Boolean(session.data && mine.data && review.data) && !session.isFetching && !mine.isFetching && !review.isFetching;
  useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(warmTaskSheet, 1000);
    return () => window.clearTimeout(timer);
  }, [fresh]);
  const failed = [session, mine, review].find((query) => query.error);
  if (failed) return <LoadFailed error={failed.error} onRetry={() => void failed.refetch()} />;
  if (!session.data?.user || !mine.data || !review.data) return null;
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className={phone ? 'grid grid-cols-[minmax(0,1fr)] gap-4' : 'grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8'}>
      <HomeBody
        session={session.data}
        mine={mine.data}
        review={review.data}
        listed={listed.data}
        listedError={listed.error}
        showLeft={showLeft}
        phone={phone}
        today={today}
        hour={officeHour()}
        onOpen={open}
        onFocus={startFocus}
        onRetry={retryProjects}
      />
      {taskId && <HomeTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
