import { AnimatePresence } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { diffDays, formatDay, todayISO, weekStartOf } from '../../lib/dates';
import { counted } from '../../lib/grammar';
import { dayRing, dueByToday, greetingKey, nextForYou, officeHour } from '../../lib/home';
import { useFocusLink } from '../focus/focusLink';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { ProjectListRow } from '../projects/ProjectListRow';
import { DayRing } from './DayRing';
import { NextCard } from './NextCard';
import { TodayPanel } from './TodayPanel';

/** Home (redesign spec 3.2): your day on the start side, your projects on the end side; one column on a phone. */
export function HomeScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const focus = useFocusLink();
  const today = todayISO();
  const session = useCall('session.get', {});
  const mine = useCall('tasks.list', { filter: 'mine' });
  const review = useCall('tasks.list', { filter: 'review_for_me' });
  const week = useCall('time.week', { weekStart: weekStartOf(today) });
  // The Admin sees every active project; anyone else sees the projects they lead or work on.
  const admin = session.data?.user.systemRole === 'admin';
  const projects = useCall('projects.list', { filter: admin ? 'all' : 'mine', sort: 'deadline' }, );
  const open = useCallback((projectId: string, taskId: string) => setParams({ project: projectId, task: taskId }), [setParams]);
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    return next;
  }), [setParams]);
  const [showLeft, setShowLeft] = useState(false);
  const queryClient = useQueryClient();
  // The "Done. N more today." line shows only after the person finishes something here, and fades after 5 seconds (moment 3).
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
  const failed = [session, mine, review, week].find((query) => query.error);
  if (failed) return <LoadFailed error={failed.error} onRetry={() => void failed.refetch()} />;
  const user = session.data?.user;
  if (!user || !mine.data || !review.data || !week.data) return null;

  // The office week runs Sunday to Thursday (spec 7.1).
  const dayIndex = diffDays(week.data.weekStart, today);
  const workday = dayIndex >= 0 && dayIndex <= 4;
  const loggedToday = week.data.dayTotals[dayIndex] ?? 0;
  const next = nextForYou({ review: review.data, mine: mine.data, today, hoursUnderTarget: week.data.weekTotal < week.data.target, workday });
  const ring = dayRing(mine.data, today);
  const todayRows = dueByToday(mine.data, today);
  const things = todayRows.length + review.data.length;
  const firstName = user.name.split(' ')[0];
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        <ScreenTitle title={t(`home.greeting.${greetingKey(officeHour())}`, { name: firstName })}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              {formatDay(today, lang, 'weekday')}
              {things > 0 && <> · {counted(t, 'home.things', things)}</>}
            </span>
            <DayRing done={ring.done} total={ring.total} />
          </span>
        </ScreenTitle>
        <NextCard item={next} onOpen={open} onFocus={focus.open} left={showLeft && ring.total - ring.done > 0 ? ring.total - ring.done : null} />
        <TodayPanel rows={todayRows} logHours={workday && loggedToday === 0 && week.data.target > 0} onOpen={(row) => open(row.project.id, row.task.id)} />
      </div>
      <section aria-labelledby="your-projects" className="flex min-w-0 flex-col gap-3 md:pt-[4.25rem]">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 id="your-projects" className="text-section text-ink">{t('home.projects')}</h2>
          {projects.data && <span className="tabular text-subheadline text-ink-2">{counted(t, 'home.projectCount', projects.data.length)}</span>}
        </div>
        {projects.error && <LoadFailed error={projects.error} onRetry={() => void projects.refetch()} />}
        {projects.data && projects.data.length === 0 && <p className="panel px-5 py-4 text-subheadline text-ink-2">{t('home.noProjects')}</p>}
        {projects.data && projects.data.length > 0 && (
          <ul aria-label={t('home.projects')} className="@container panel hairline overflow-hidden">
            <AnimatePresence initial={false}>
              {projects.data.map((summary) => <ProjectListRow key={summary.project.id} summary={summary} />)}
            </AnimatePresence>
          </ul>
        )}
        <Link to="/projects" className="flex min-h-11 items-center self-start px-1 text-subheadline font-semibold text-link">{t('home.allProjects')}</Link>
      </section>
      {taskId && projectId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
