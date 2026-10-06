import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useIsPhone } from '../../app/useIsPhone';
import { MeetingProvider } from '../../app/meeting';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ProjectTile } from '../../components/ProjectTile';
import { SegmentedControl } from '../../components/SegmentedControl';
import { ProjectSign } from '../../components/ProjectSign';
import { StatusSign } from '../../components/StatusSign';
import { formatDay, formatMonth, formatMonthYear, todayISO } from '../../lib/dates';
import { clipSpan, MEETING_ZOOMS, meetingStep, meetingWindow, midPct, offsetPct, widthPct, type MeetingZoom } from '../../lib/schedule';
import { stageOverlaps } from '../../lib/stageFlow';
import { oneOf, teamParam } from '../../lib/params';
import { agendaOrder } from '../../lib/agenda';
import { MeetingProject, meetingWork } from './MeetingProjects';
import { AgendaBar, AgendaButton } from './meeting/AgendaBar';
import { AgendaSheet } from './meeting/AgendaSheet';
import { MeetingSummary } from './meeting/MeetingSummary';
import { useMeetingSession } from './meeting/session';
import { useWakeLock } from './meeting/useWakeLock';
import type { DashboardData } from './Tiles';
import { clientName } from '../../lib/clientName';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { useHatchOn } from './hatch';
import { PicturesProvider } from '../../app/pictures';
import { usePersonName } from '../../app/personName';
import { currentTone, DeadlineMarks, stageKind } from './scheduleMarks';

// The same status choices as the Dashboard: Completed or Archived in a link reads as Active (audit 2026-10-03, DSH-13).
const STATUSES = ['active', 'on_hold', 'all'] as const;
const MODES = ['timeline', 'projects'] as const;
const USER_ID = /^usr_\d{3,}$/;
const CLIENT_ID = /^cli_\d{3,}$/;
// A stage bar shows its name when it spans at least this share of the window.
const LABEL_MIN_PCT = 11;
// The big-screen choice stays on this computer. Blocked storage means off.
const BIG_SCREEN_KEY = 'madar.meeting.bigScreen';
const BIG_SCREEN_ZOOM = 1.25;
const readBigScreen = () => {
  try { return window.localStorage.getItem(BIG_SCREEN_KEY) === '1'; } catch { return false; }
};
// The zoom also stays on this computer, so the meeting opens the same way each week. Blocked storage means Quarter.
const ZOOM_KEY = 'madar.meeting.zoom';
const readZoom = (): MeetingZoom => {
  try { return oneOf(window.localStorage.getItem(ZOOM_KEY), MEETING_ZOOMS, 'quarter'); } catch { return 'quarter'; }
};
const COLUMNS = 'grid grid-cols-[minmax(14rem,24rem)_minmax(0,1fr)] gap-x-6';

type Row = DashboardData['schedule'][number];

function StateOfRow({ health, pause }: { health: Row['health']; pause: Row['pause'] }) {
  const { t } = useTranslation();
  if (pause) return <ProjectSign project={{ status: 'on_hold', pause }} staleDays={pause.staleDays} />;
  if (health === 'late') return <StatusSign state="late">{t('health.late')}</StatusSign>;
  if (health === 'at_risk') return <StatusSign state="at_risk">{t('health.at_risk')}</StatusSign>;
  return null;
}

/**
 * "1 past due · 1 waiting for review · 2 in progress" under a project name on the timeline: the same lists as the project
 * screen, the urgent ones first. A count of zero says nothing, so it is not there, and with no work the line is empty.
 */
function WorkLine({ work }: { work: ReturnType<typeof meetingWork> }) {
  const { t } = useTranslation();
  const parts = ([
    ['countPastDue', work.pastDue.length],
    ['countReview', work.review.length],
    ['countFlagged', work.flagged.length],
    ['countInProgress', work.doing.length],
  ] as const).filter(([, n]) => n > 0).map(([key, n]) => t(`dashboard.meeting.${key}`, { n }));
  if (parts.length === 0) return null;
  return <span className={`block truncate text-[15px] ${work.pastDue.length > 0 ? 'text-attn' : 'text-ink-2'}`}>{parts.join(' · ')}</span>;
}

function Bars({ row, span, drawing, index }: { row: Row; span: { start: string; end: string }; drawing: boolean; index: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const current = row.stages.findIndex((stage) => stage.id === row.currentStageId);
  const nameOf = (id: string) => row.stages.find((stage) => stage.id === id)?.name ?? '';
  const overlaps = stageOverlaps(row.stages);
  const startsInside = new Set(overlaps.map((overlap) => overlap.stageIds[1]));
  // The current stage draws last, so it lies over a next stage that starts inside it, and the next stage's outline
  // never crosses the current bar.
  const stages = row.stages.map((stage, i) => ({ stage, kind: stageKind(i, current) }));
  const order = [...stages.filter((item) => item.kind !== 'current'), ...stages.filter((item) => item.kind === 'current')];
  return (
    <>
      {order.map(({ stage, kind }) => {
        if (!stage.startDate || !stage.endDate) return null;
        const part = clipSpan({ start: stage.startDate, end: stage.endDate }, span);
        if (!part) return null;
        const width = widthPct(span, part.start, part.end);
        const tone = kind === 'done' ? 'bg-ink-2/35 text-ink' : kind === 'current' ? currentTone(row.pause !== null, row.health) : 'ring-2 ring-inset ring-chart-muted text-ink-2';
        // A stage that starts inside an earlier one shows its name at its end, out from under the bar before it.
        const side = kind !== 'current' && startsInside.has(stage.id) ? 'justify-end' : '';
        const style = {
          insetInlineStart: `${offsetPct(span, part.start)}%`,
          width: `${width}%`,
          animationDelay: `${Math.min(index, 12) * 40}ms`,
        };
        return (
          <span
            key={stage.id}
            title={stage.name}
            role="img"
            aria-label={t('dashboard.meeting.stage', { stage: stage.name, state: t(`dashboard.meeting.stageStates.${kind}`) })}
            style={style}
            className={`absolute top-2 flex h-9 items-center overflow-hidden rounded-full px-3 text-[16px] font-semibold leading-none ${tone} ${side} ${drawing ? 'draw-line' : ''}`}
          >
            {width >= LABEL_MIN_PCT && <bdi className="truncate">{stage.name}</bdi>}
          </span>
        );
      })}
      {/* Two stages at the same time: the one line says it to a screen reader only, because stripes here covered a stage name.
          The opened lines show the stripes, where each stage has its own line. */}
      {overlaps.map((overlap) => (clipSpan(overlap, span) ? (
        <span key={overlap.stageIds.join('-')} role="img" aria-label={t('dashboard.meeting.overlap', { a: nameOf(overlap.stageIds[0]), b: nameOf(overlap.stageIds[1]) })} className="sr-only" />
      ) : null))}
      <DeadlineMarks
        marks={row.deadlines.filter((d) => d.date >= span.start && d.date <= span.end).map((d) => ({
          id: d.id, name: d.name, when: formatDay(d.date, lang), at: midPct(span, d.date),
          label: t('dashboard.meeting.deadline', { name: d.name, date: formatDay(d.date, lang) }),
        }))}
      />
    </>
  );
}

/** One line for each stage of an opened project, in time order, so stages that run at the same time show side by side. */
function StageLines({ row, span, todayAt, todayIn }: { row: Row; span: { start: string; end: string }; todayAt: { insetInlineStart: string }; todayIn: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const current = row.stages.findIndex((stage) => stage.id === row.currentStageId);
  // The person's hatch choice of the Dashboard and the project schedule applies here too (owner, 2026-10-05, item 9).
  const overlaps = useHatchOn() ? stageOverlaps(row.stages) : [];
  return (
    <>
      {row.stages.map((stage, i) => {
        const part = stage.startDate && stage.endDate ? clipSpan({ start: stage.startDate, end: stage.endDate }, span) : null;
        const kind = stageKind(i, current);
        const tone = kind === 'done' ? 'bg-ink-2/35' : kind === 'current' ? currentTone(row.pause !== null, row.health) : 'ring-2 ring-inset ring-chart-muted';
        return (
          <div key={stage.id} className={`${COLUMNS} items-center`}>
            <div className="min-w-0 ps-[3.75rem] text-[17px] text-ink-2">
              <bdi className="block truncate">{stage.name}</bdi>
              {stage.startDate && stage.endDate && <span className="sr-only">{t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })}</span>}
            </div>
            <div className="relative h-12">
              {todayIn && <span aria-hidden style={todayAt} className="absolute inset-y-0 w-0.5 bg-ink/70" />}
              {part && (
                <span
                  role="img"
                  aria-label={t('dashboard.meeting.stage', { stage: stage.name, state: t(`dashboard.meeting.stageStates.${kind}`) })}
                  style={{ insetInlineStart: `${offsetPct(span, part.start)}%`, width: `${widthPct(span, part.start, part.end)}%` }}
                  className={`absolute top-3 h-6 rounded-full ${tone}`}
                />
              )}
              {overlaps.filter((overlap) => overlap.stageIds.includes(stage.id)).map((overlap) => {
                const shared = clipSpan(overlap, span);
                if (!shared) return null;
                return (
                  <span
                    key={overlap.stageIds.join('-')}
                    aria-hidden
                    style={{ insetInlineStart: `${offsetPct(span, shared.start)}%`, width: `${widthPct(span, shared.start, shared.end)}%` }}
                    className="overlap-hatch absolute top-3 h-6 rounded-full opacity-60"
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** The task panel over the meeting. It opens with the project of the task, so the team and the stages in it are the ones of that project. */
function MeetingTaskSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useCall('tasks.get', { id: taskId });
  useEffect(() => {
    if (task.error) onClose();
  }, [task.error, onClose]);
  if (!task.data) return null;
  return <ProjectTaskSheet projectId={task.data.project?.id ?? null} taskId={taskId} onClose={onClose} />;
}

/**
 * The meeting-room screen: every project on one big timeline (owner request, 2026-10-01).
 * It keeps the Dashboard filters from the link. Time runs toward the end side, so Arabic reads right to left.
 */
/** The meeting view sits outside the app frame, so it reads the profile pictures itself (owner item 10, 2026-10-05). */
export function MeetingView() {
  return <PicturesProvider><MeetingScreen /></PicturesProvider>;
}

function MeetingScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // A phone has no room for the timeline bars, so the meeting opens on the project screens there (browser audit 2026-10-03, BRW-18).
  // The bars got no width at all on a phone, so a phone offers the project screens only: the View choice hides, and a
  // timeline link opens the project screens (audit 2026-10-03, F-5).
  const isPhone = useIsPhone();
  const firstMode = isPhone ? 'projects' : 'timeline';
  const mode = isPhone ? 'projects' : oneOf(params.get('mode'), MODES, firstMode);
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const leader = params.get('leader') ?? '';
  const client = params.get('client') ?? '';
  const team = params.get('team') ?? '';
  const dashboard = useCall('dashboard.get', {
    status,
    leaderId: USER_ID.test(leader) ? leader : undefined,
    clientId: CLIENT_ID.test(client) ? client : undefined,
    teamId: teamParam(team),
  });
  // Every open task of the office, once, for the counts on the timeline and the project screens.
  const tasks = useCall('tasks.list', { includeDone: false, activeProjectsOnly: false });
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const teams = useCall('teams.list', {});
  // The project screens follow the meeting agenda (owner, 2026-10-02): the projects that need the team most come first.
  // The timeline keeps its own order. The session keeps the agenda, the current project and the clocks for the day.
  const schedule = dashboard.data?.schedule;
  const agendaIds = useMemo(() => agendaOrder(schedule ?? []).map((row) => row.project.id), [schedule]);
  const rowOf = useMemo(() => new Map((schedule ?? []).map((row) => [row.project.id, row])), [schedule]);
  const names = useMemo(() => new Map((schedule ?? []).map((row) => [row.project.id, row.project.name])), [schedule]);
  // The summary takes the place of the screen. Back shows the same mode and the same project again.
  const [summaryOpen, setSummaryOpen] = useState(false);
  // The clock of a project runs only while its screen shows, so not on the timeline and not behind the summary.
  const session = useMeetingSession(agendaIds, mode === 'projects' && !summaryOpen);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [bigScreen, setBigScreen] = useState(readBigScreen);
  const changeBigScreen = (on: boolean) => {
    try { window.localStorage.setItem(BIG_SCREEN_KEY, on ? '1' : '0'); } catch { /* blocked storage: the choice lasts until the page closes */ }
    setBigScreen(on);
  };
  useWakeLock();
  // Big screen zooms the whole page, so the panels over the meeting grow too: they live outside <main>.
  // Zoom also scales the screen-height units, so the page divides its height by the zoom and still fits the screen.
  useEffect(() => {
    if (!bigScreen) return;
    const root = document.documentElement.style;
    const body = document.body.style;
    const before = { zoom: root.zoom, minHeight: body.minHeight };
    root.zoom = String(BIG_SCREEN_ZOOM);
    body.minHeight = `calc(100dvh / ${BIG_SCREEN_ZOOM})`;
    return () => {
      root.zoom = before.zoom;
      body.minHeight = before.minHeight;
    };
  }, [bigScreen]);
  const [zoom, setZoomState] = useState<MeetingZoom>(readZoom);
  const setZoom = (next: MeetingZoom) => {
    try { window.localStorage.setItem(ZOOM_KEY, next); } catch { /* blocked storage: the choice lasts until the page closes */ }
    setZoomState(next);
  };
  const [shift, setShift] = useState(0);
  // A project shows its stages on one line. A press opens it to one line for each stage.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpened((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const setMode = (next: (typeof MODES)[number], projectId?: string) => {
    if (projectId !== undefined) session.goTo(session.order.indexOf(projectId));
    setParams((current) => {
      const value = new URLSearchParams(current);
      if (next === firstMode) value.delete('mode');
      else value.set('mode', next);
      return value;
    }, { replace: true });
  };
  // The bars draw in once, when the view opens. A later move of the window does not draw them again.
  const [drawing, setDrawing] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setDrawing(false), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  const rtl = lang === 'ar';
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const summaryRef = useRef(summaryOpen);
  summaryRef.current = summaryOpen;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The meeting started when the session of the day started, so a reload keeps the same start.
  const drafts = useRef(new Map<string, string>()).current;
  const meeting = useMemo(() => ({ startedAt: session.startedAt, drafts }), [session.startedAt, drafts]);
  // The open task lives in the link, so a reload keeps it. A press replaces the entry, it does not add one.
  const taskId = params.get('task');
  const openTask = (id: string) => setParams((current) => {
    const value = new URLSearchParams(current);
    value.set('task', id);
    return value;
  }, { replace: true });
  const closeTask = () => setParams((current) => {
    const value = new URLSearchParams(current);
    value.delete('task');
    return value;
  }, { replace: true });
  // The task panel belongs to the screen it opened on. Another project, another mode or the summary closes it,
  // so Done, Skip and the arrows never leave a panel open over a project that is not on the screen.
  // The first project shows when the data arrives. That is not a move, so a panel from the link stays open.
  const place = useRef({ mode, currentId: session.currentId, summaryOpen });
  useEffect(() => {
    const before = place.current;
    place.current = { mode, currentId: session.currentId, summaryOpen };
    const moved = before.mode !== mode || before.summaryOpen !== summaryOpen || (before.currentId !== null && before.currentId !== session.currentId);
    if (moved && taskId) closeTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a move of the screen closes the panel
  }, [mode, session.currentId, summaryOpen]);
  // The Dashboard takes the filters back, not the meeting mode or the open task (browser audit 2026-10-03, BRW-1).
  const exit = () => {
    const search = new URLSearchParams(params);
    search.delete('mode');
    search.delete('task');
    // Only the Schedule section shows and keeps a status, so a meeting with a status goes back there.
    // Another section drops the status from the next meeting (audit 2026-10-03, V-12 repair).
    if (status !== 'active') search.set('view', 'schedule');
    navigate({ pathname: '/dashboard', search: search.toString() });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // A dialog or a menu owns the keys while it is open. Escape then closes it only.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      // A key with a modifier belongs to the browser. A key in a field belongs to the field, so Escape there keeps the typed text.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (target instanceof Element && (target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])') || (target as HTMLElement).isContentEditable)) return;
      // A held key repeats. One press is one step, so a held N does not run through the whole agenda.
      if (event.repeat) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        // Escape on the summary goes back to the same screen. The next Escape leaves the meeting.
        if (summaryRef.current) setSummaryOpen(false);
        else exit();
        return;
      }
      // The letter keys go by the physical key, so an Arabic keyboard works too.
      const letter = ['KeyN', 'KeyB', 'KeyA', 'KeyT'].includes(event.code);
      if (letter) {
        if (summaryRef.current) return;
        const run = sessionRef.current;
        // The agenda opens in both modes. The other letters work on the project screens only.
        if (event.code === 'KeyA') { event.preventDefault(); setAgendaOpen(true); return; }
        if (modeRef.current !== 'projects') return;
        event.preventDefault();
        if (event.code === 'KeyN') run.goTo(run.current + 1);
        else if (event.code === 'KeyB') run.goTo(run.current - 1);
        else run.togglePause();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (summaryRef.current || target?.closest('[role="radiogroup"]')) return;
      event.preventDefault();
      const toEnd = (event.key === 'ArrowRight') !== rtl;
      // On the project screens the arrows move along the agenda; on the timeline they move one step (a week or a month).
      if (modeRef.current === 'projects') sessionRef.current.goTo(sessionRef.current.current + (toEnd ? 1 : -1));
      else setShift((n) => n + (toEnd ? 1 : -1));
    };
    // The meeting hears a key first, on the way down. A sheet closes itself on Escape, and a browser can draw that before a later
    // listener runs, so a listener on the way up found no dialog and left the whole meeting (browser audit 2026-10-03, BRW-1).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exit reads the current link each time the link changes
  }, [rtl, params.toString()]);

  const today = todayISO();
  const { span, ticks } = meetingWindow(today, zoom, shift);
  // The arrows say how far they move: one week in the week zoom, one month in the others.
  const step = meetingStep(zoom);
  // Week: "Wed 30". Month: "4 Oct". Short labels never run into each other, also in Arabic on the big screen.
  // The longer zooms show a month, and the first label and January carry the year.
  const tickLabel = (tick: string, first: boolean) => {
    if (zoom === 'week') return formatDay(tick, lang, 'weekdayDay');
    if (zoom === 'month') return formatDay(tick, lang);
    return `${formatMonth(tick, lang)}${first || tick.endsWith('-01-01') ? ` ${tick.slice(0, 4)}` : ''}`;
  };
  // The week and the month show their name once, in words, above the project names: "27 Sept to 3 Oct 2026", "October 2026".
  const windowName =
    zoom === 'week' ? t('dashboard.meeting.weekRange', { from: formatDay(span.start, lang), to: formatDay(span.end, lang, 'shortYear') })
    : zoom === 'month' ? formatMonthYear(span.start, lang)
    : null;
  const todayIn = today >= span.start && today <= span.end;
  // Today and the deadlines sit in the middle of their day, so in the week zoom they sit inside their day column.
  const todayAt = { insetInlineStart: `${midPct(span, today)}%` };
  const view = dashboard.data;

  const filters = [
    status !== 'active' ? t('dashboard.meeting.status', { name: t(`status.${status}`) }) : null,
    leader ? t('dashboard.meeting.leader', { name: ((found) => (found ? nameOf(found) : leader))(users.data?.find((u) => u.id === leader)) }) : null,
    team ? t('dashboard.meeting.team', { name: teams.data?.find((item) => item.id === team)?.name ?? team }) : null,
    client ? t('dashboard.meeting.client', { name: ((found) => (found ? clientName(found, lang) : client))(clients.data?.find((c) => c.id === client)) }) : null,
  ].filter((text): text is string => text !== null);

  const shown = session.currentId ? rowOf.get(session.currentId) ?? null : null;
  return (
    <MeetingProvider value={meeting}>
    <main
      aria-label={t('dashboard.meeting.title')}
      // The page zoom makes everything 1.25 times larger, the screen height too. The height shrinks by the same factor, so the screen still fits.
      style={bigScreen ? { height: `calc(100dvh / ${BIG_SCREEN_ZOOM})` } : undefined}
      className="meeting-type flex h-dvh flex-col overflow-hidden px-6 pb-4 pt-5 text-ink sm:px-10"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-4">
        <div className="min-w-0">
          <h1 className="text-[34px] font-bold leading-tight text-ink">{t('app.name')}</h1>
          <p className="text-[18px] text-ink-2">
            <span>{formatDay(today, lang, 'weekday')}</span>
            <span aria-hidden> · </span>
            <span>{filters.length > 0 ? t('dashboard.meeting.filters', { list: filters.join(', ') }) : t('dashboard.meeting.noFilters')}</span>
          </p>
        </div>
        <div role="group" aria-label={t('dashboard.meeting.controls')} className="flex flex-wrap items-center gap-2">
          {/* The view switch does nothing while the summary covers the screen, so it hides there. Back is the one way back.
              A phone shows the project screens only, so it has no switch (audit 2026-10-03, F-5). */}
          {!summaryOpen && !isPhone && (
            <SegmentedControl
              label={t('dashboard.meeting.mode')}
              value={mode}
              onChange={(next) => setMode(next)}
              options={MODES.map((value) => ({ value, label: t(`dashboard.meeting.modes.${value}`) }))}
            />
          )}
          {session.order.length > 0 && (
            <AgendaButton session={session} showPosition={!summaryOpen && mode === 'projects'} onOpenAgenda={() => setAgendaOpen(true)} />
          )}
          {/* The summary takes the place of the screen, so the controls of the screen below it hide too.
              Done and Skip are the only ways forward on screen. The arrow keys, N and B, and the Agenda still move anywhere. */}
          {!summaryOpen && mode === 'projects' && shown && <AgendaBar session={session} name={shown.project.name} onOpenSummary={() => setSummaryOpen(true)} />}
          {!summaryOpen && mode === 'timeline' && (
          <>
          <SegmentedControl
            label={t('dashboard.meeting.zoom')}
            value={zoom}
            onChange={(next) => { setZoom(next); setShift(0); }}
            options={MEETING_ZOOMS.map((value) => ({ value, label: t(`dashboard.meeting.zooms.${value}`) }))}
          />
          {/* Earlier, Today and later wrap as one piece, so the two arrows never sit on two rows (audit 2026-10-03, F-5). */}
          <div className="flex flex-nowrap items-center gap-2">
            <Button aria-label={t(`dashboard.meeting.earlier.${step}`)} title={t(`dashboard.meeting.earlier.${step}`)} className="!px-3" onClick={() => setShift((n) => n - 1)}>
              <AnimatedIcon icon={ChevronLeftIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
            </Button>
            <Button onClick={() => setShift(0)}>{t('dashboard.meeting.today')}</Button>
            <Button aria-label={t(`dashboard.meeting.later.${step}`)} title={t(`dashboard.meeting.later.${step}`)} className="!px-3" onClick={() => setShift((n) => n + 1)}>
              <AnimatedIcon icon={ChevronRightIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
            </Button>
          </div>
          </>
          )}
          <Button variant="plain" onClick={exit}>{t('dashboard.meeting.exit')}</Button>
        </div>
      </header>

      {dashboard.error && (
        <EmptyState title={t('dashboard.meeting.title')} body={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>} />
      )}
      {view && view.schedule.length === 0 && <p className="text-[20px] text-ink-2">{t('dashboard.noData')}</p>}
      {summaryOpen && (
        <MeetingSummary agendaIds={session.meetingIds} names={names} startedAt={session.startedAt} shared={session.shared} onShared={session.markShared} onBack={() => setSummaryOpen(false)} />
      )}
      {!summaryOpen && mode === 'projects' && shown && (
        <MeetingProject
          key={shown.project.id}
          row={shown}
          tasks={tasks.data ?? []}
          discussed={session.discussed.has(shown.project.id)}
          onOpenTask={openTask}
        />
      )}
      {!summaryOpen && mode === 'timeline' && view && view.schedule.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-card panel">
          <div className={`sticky top-0 z-20 border-b border-separator bg-[var(--c-panel)] px-5 ${COLUMNS}`}>
            <div className="flex min-w-0 items-center">
              {windowName && <span className="truncate text-[18px] font-semibold text-ink">{windowName}</span>}
            </div>
            <div aria-hidden className="relative h-12">
              {/* In the week zoom each label fills its day column and stands in the middle of it, above the Today tag. */}
              {ticks.map((tick) => (
                <span
                  key={tick}
                  style={{ insetInlineStart: `${offsetPct(span, tick)}%`, ...(zoom === 'week' ? { width: `${widthPct(span, tick, tick)}%` } : {}) }}
                  className={`absolute inset-y-2 whitespace-nowrap border-s border-separator text-[16px] font-medium leading-5 text-ink-2 ${zoom === 'week' ? 'text-center' : 'ps-2'}`}
                >
                  {tickLabel(tick, tick === ticks[0])}
                </span>
              ))}
              {todayIn && (
                <span style={todayAt} className="absolute bottom-0 -translate-x-1/2 rounded-full bg-ink px-2 py-0.5 text-[14px] font-semibold leading-none text-bg rtl:translate-x-1/2">
                  {t('dashboard.meeting.today')}
                </span>
              )}
            </div>
          </div>
          <ul aria-label={t('dashboard.meeting.timeline')} className="px-5">
            {view.schedule.map((row, index) => {
              const isOpen = opened.has(row.project.id);
              return (
                <li key={row.project.id} className="border-b border-separator last:border-b-0">
                  <div className={`${COLUMNS} items-center`}>
                    <div className="min-w-0 py-3">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`stages-${row.project.id}`}
                        onClick={() => toggle(row.project.id)}
                        className="pressable flex w-full min-w-0 items-center gap-3 rounded-2xl text-start"
                      >
                        <ProjectTile id={row.project.id} mark={row.project.mark} size={48} />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <bdi className="min-w-0 truncate text-[22px] font-semibold text-ink">{row.project.name}</bdi>
                            <StateOfRow health={row.health} pause={row.pause} />
                          </span>
                          {tasks.data && <WorkLine work={meetingWork(tasks.data, row.project.id, today)} />}
                          <span className="sr-only">{t('dashboard.meeting.expandHint')}</span>
                        </span>
                        <AnimatedIcon icon={ChevronDownIcon} size={20} aria-hidden className={`size-5 shrink-0 text-ink-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && (
                        <Button variant="plain" className="ms-[3.75rem]" aria-label={t('dashboard.meeting.openProjectOf', { name: row.project.name })} onClick={() => setMode('projects', row.project.id)}>
                          {t('dashboard.meeting.openProject')}
                        </Button>
                      )}
                    </div>
                    <div className="relative h-[4.5rem]">
                      {todayIn && <span aria-hidden style={todayAt} className="absolute inset-y-0 w-0.5 bg-ink/70" />}
                      <Bars row={row} span={span} drawing={drawing} index={index} />
                    </div>
                  </div>
                  {isOpen && (
                    <div id={`stages-${row.project.id}`} role="group" aria-label={t('dashboard.meeting.stagesOf', { name: row.project.name })} className="pb-3">
                      <StageLines row={row} span={span} todayAt={todayAt} todayIn={todayIn} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {mode === 'projects' && taskId && <MeetingTaskSheet key={taskId} taskId={taskId} onClose={closeTask} />}
      {agendaOpen && (
        <AgendaSheet
          rows={rowOf}
          session={session}
          bigScreen={bigScreen}
          onBigScreen={changeBigScreen}
          onPick={(id) => { setSummaryOpen(false); setMode('projects', id); }}
          onSummary={() => setSummaryOpen(true)}
          onClose={() => setAgendaOpen(false)}
        />
      )}
    </main>
    </MeetingProvider>
  );
}
