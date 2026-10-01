import { useEffect, useRef, useState } from 'react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ProjectTile } from '../../components/ProjectTile';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusSign } from '../../components/StatusSign';
import { formatDay, formatMonth, todayISO } from '../../lib/dates';
import { projectHue } from '../../lib/projectColor';
import { clipSpan, MEETING_ZOOMS, meetingWindow, offsetPct, widthPct, type MeetingZoom } from '../../lib/schedule';
import { oneOf } from '../../lib/params';
import { MeetingProject, meetingWork } from './MeetingProjects';
import type { DashboardData } from './Tiles';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const MODES = ['timeline', 'projects'] as const;
const USER_ID = /^usr_\d{3,}$/;
const CLIENT_ID = /^cli_\d{3,}$/;
// A stage bar shows its name when it spans at least this share of the window.
const LABEL_MIN_PCT = 11;
const COLUMNS = 'grid grid-cols-[minmax(14rem,24rem)_minmax(0,1fr)] gap-x-6';

type Row = DashboardData['schedule'][number];

function StateOfRow({ health }: { health: Row['health'] }) {
  const { t } = useTranslation();
  if (health === 'late') return <StatusSign state="late">{t('health.late')}</StatusSign>;
  if (health === 'at_risk') return <StatusSign state="at_risk">{t('health.at_risk')}</StatusSign>;
  return null;
}

/** One deadline diamond. The name shows on hover and on focus, and it is the label for screen readers. */
function DeadlineMark({ name, label, at }: { name: string; label: string; at: number }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      style={{ insetInlineStart: `calc(${at}% - 9px)` }}
      className="group absolute bottom-1 z-10 grid size-[18px] place-items-center rounded-sm outline-offset-4"
    >
      <span aria-hidden className="size-3 rotate-45 rounded-sm bg-attn" />
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-full mb-2 hidden w-max max-w-72 rounded-xl bg-ink px-3 py-1.5 text-[16px] font-medium text-bg group-hover:block group-focus-visible:block ${at > 70 ? 'end-0' : 'start-0'}`}
      >
        {name}
      </span>
    </button>
  );
}

/** "2 in progress · 1 past due · 1 waits for review" under a project name on the timeline. */
function WorkLine({ work }: { work: ReturnType<typeof meetingWork> }) {
  const { t } = useTranslation();
  const parts = [
    t('dashboard.meeting.countInProgress', { n: work.doing.length }),
    work.pastDue.length > 0 ? t('dashboard.meeting.countPastDue', { n: work.pastDue.length }) : null,
    work.review.length > 0 ? t('dashboard.meeting.countReview', { n: work.review.length }) : null,
  ].filter(Boolean);
  return <span className={`block truncate text-[15px] ${work.pastDue.length > 0 ? 'text-attn' : 'text-ink-2'}`}>{parts.join(' · ')}</span>;
}

function Bars({ row, span, drawing, index }: { row: Row; span: { start: string; end: string }; drawing: boolean; index: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const hue = projectHue(row.project.id);
  const current = row.stages.findIndex((stage) => stage.id === row.currentStageId);
  return (
    <>
      {row.stages.map((stage, i) => {
        if (!stage.startDate || !stage.endDate) return null;
        const part = clipSpan({ start: stage.startDate, end: stage.endDate }, span);
        if (!part) return null;
        const kind = i < current ? 'done' : i === current ? 'current' : 'next';
        const width = widthPct(span, part.start, part.end);
        const tone = kind === 'done' ? 'bg-ink-2/35 text-ink' : kind === 'current' ? '' : 'ring-2 ring-inset ring-chart-muted text-ink-2';
        const style = {
          insetInlineStart: `${offsetPct(span, part.start)}%`,
          width: `${width}%`,
          animationDelay: `${Math.min(index, 12) * 40}ms`,
          ...(kind === 'current' ? { background: `var(--p-${hue}-fg)`, color: `var(--p-${hue}-bg)` } : {}),
        };
        return (
          <span
            key={stage.id}
            title={stage.name}
            role="img"
            aria-label={t('dashboard.meeting.stage', { stage: stage.name, state: t(`dashboard.meeting.stageStates.${kind}`) })}
            style={style}
            className={`absolute top-2 flex h-9 items-center overflow-hidden rounded-full px-3 text-[16px] font-semibold leading-none ${tone} ${drawing ? 'draw-line' : ''}`}
          >
            {width >= LABEL_MIN_PCT && <bdi className="truncate">{stage.name}</bdi>}
          </span>
        );
      })}
      {row.deadlines.filter((d) => d.date >= span.start && d.date <= span.end).map((d) => (
        <DeadlineMark key={d.id} name={d.name} at={offsetPct(span, d.date)} label={t('dashboard.meeting.deadline', { name: d.name, date: formatDay(d.date, lang) })} />
      ))}
    </>
  );
}

/**
 * The meeting-room screen: every project on one big timeline (owner request, 2026-10-01).
 * It keeps the Dashboard filters from the link. Time runs toward the end side, so Arabic reads right to left.
 */
export function MeetingView() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode = oneOf(params.get('mode'), MODES, 'timeline');
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const leader = params.get('leader') ?? '';
  const client = params.get('client') ?? '';
  const dashboard = useCall('dashboard.get', {
    status,
    leaderId: USER_ID.test(leader) ? leader : undefined,
    clientId: CLIENT_ID.test(client) ? client : undefined,
  });
  // Every open task of the office, once, for the counts on the timeline and the project screens.
  const tasks = useCall('tasks.list', { includeDone: false, activeProjectsOnly: false });
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const [zoom, setZoom] = useState<MeetingZoom>('half');
  const [shift, setShift] = useState(0);
  const [slide, setSlide] = useState(0);
  const setMode = (next: (typeof MODES)[number], at?: number) => {
    if (at !== undefined) setSlide(at);
    setParams((current) => {
      const value = new URLSearchParams(current);
      if (next === 'timeline') value.delete('mode');
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
  const countRef = useRef(0);
  countRef.current = dashboard.data?.schedule.length ?? 0;
  const exit = () => navigate({ pathname: '/dashboard', search: params.toString() });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        event.preventDefault();
        exit();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, select, textarea, [role="radiogroup"]')) return;
      event.preventDefault();
      const toEnd = (event.key === 'ArrowRight') !== rtl;
      // On the project screens the arrows move between projects; on the timeline they move one month.
      if (modeRef.current === 'projects') setSlide((n) => Math.min(Math.max(0, n + (toEnd ? 1 : -1)), countRef.current - 1));
      else setShift((n) => n + (toEnd ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exit reads the current link each time the link changes
  }, [rtl, params.toString()]);

  const today = todayISO();
  const { span, ticks } = meetingWindow(today, zoom, shift);
  const todayIn = today >= span.start && today <= span.end;
  const todayAt = { insetInlineStart: `${offsetPct(span, today)}%` };
  const view = dashboard.data;

  const filters = [
    status !== 'active' ? t('dashboard.meeting.status', { name: t(`status.${status}`) }) : null,
    leader ? t('dashboard.meeting.leader', { name: users.data?.find((u) => u.id === leader)?.name ?? leader }) : null,
    client ? t('dashboard.meeting.client', { name: clients.data?.find((c) => c.id === client)?.name ?? client }) : null,
  ].filter((text): text is string => text !== null);

  return (
    <main aria-label={t('dashboard.meeting.title')} className="flex h-dvh flex-col overflow-hidden px-6 pb-4 pt-5 text-ink sm:px-10">
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
          <SegmentedControl
            label={t('dashboard.meeting.mode')}
            value={mode}
            onChange={(next) => setMode(next)}
            options={MODES.map((value) => ({ value, label: t(`dashboard.meeting.modes.${value}`) }))}
          />
          {mode === 'projects' && view && view.schedule.length > 0 && (
            <>
              <Button aria-label={t('dashboard.meeting.previous')} title={t('dashboard.meeting.previous')} className="!px-3" disabled={slide === 0} onClick={() => setSlide((n) => Math.max(0, n - 1))}>
                <AnimatedIcon icon={ChevronLeftIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
              </Button>
              <Button aria-label={t('dashboard.meeting.next')} title={t('dashboard.meeting.next')} className="!px-3" disabled={slide >= view.schedule.length - 1} onClick={() => setSlide((n) => Math.min(view.schedule.length - 1, n + 1))}>
                <AnimatedIcon icon={ChevronRightIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
              </Button>
            </>
          )}
          {mode === 'timeline' && (
          <>
          <SegmentedControl
            label={t('dashboard.meeting.zoom')}
            value={zoom}
            onChange={(next) => { setZoom(next); setShift(0); }}
            options={MEETING_ZOOMS.map((value) => ({ value, label: t(`dashboard.meeting.zooms.${value}`) }))}
          />
          <Button aria-label={t('dashboard.meeting.earlier')} title={t('dashboard.meeting.earlier')} className="!px-3" onClick={() => setShift((n) => n - 1)}>
            <AnimatedIcon icon={ChevronLeftIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
          </Button>
          <Button onClick={() => setShift(0)}>{t('dashboard.meeting.today')}</Button>
          <Button aria-label={t('dashboard.meeting.later')} title={t('dashboard.meeting.later')} className="!px-3" onClick={() => setShift((n) => n + 1)}>
            <AnimatedIcon icon={ChevronRightIcon} size={20} aria-hidden className="size-5 rtl:-scale-x-100" />
          </Button>
          </>
          )}
          <Button variant="plain" onClick={exit}>{t('dashboard.meeting.exit')}</Button>
        </div>
      </header>

      {dashboard.error && (
        <EmptyState title={t('dashboard.meeting.title')} body={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>} />
      )}
      {view && view.schedule.length === 0 && <p className="text-[20px] text-ink-2">{t('dashboard.noData')}</p>}
      {mode === 'projects' && view && view.schedule.length > 0 && (
        <MeetingProject
          key={view.schedule[Math.min(slide, view.schedule.length - 1)].project.id}
          row={view.schedule[Math.min(slide, view.schedule.length - 1)]}
          tasks={tasks.data ?? []}
          index={Math.min(slide, view.schedule.length - 1)}
          total={view.schedule.length}
        />
      )}
      {mode === 'timeline' && view && view.schedule.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-card panel">
          <div className={`sticky top-0 z-20 border-b border-separator bg-[var(--c-panel)] px-5 ${COLUMNS}`}>
            <div />
            <div aria-hidden className="relative h-11">
              {ticks.map((tick) => (
                <span key={tick} style={{ insetInlineStart: `${offsetPct(span, tick)}%` }} className="absolute inset-y-2 whitespace-nowrap border-s border-separator ps-2 text-[16px] font-medium text-ink-2">
                  {formatMonth(tick, lang)}{tick.endsWith('-01-01') || tick === ticks[0] ? ` ${tick.slice(0, 4)}` : ''}
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
            {view.schedule.map((row, index) => (
              <li key={row.project.id} className={`${COLUMNS} items-center border-b border-separator last:border-b-0`}>
                <button type="button" onClick={() => setMode('projects', index)} className="pressable flex min-w-0 items-center gap-3 rounded-2xl py-3 text-start">
                  <ProjectTile id={row.project.id} mark={row.project.mark} size={48} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <bdi className="min-w-0 truncate text-[22px] font-semibold text-ink">{row.project.name}</bdi>
                      <StateOfRow health={row.health} />
                    </span>
                    {tasks.data && <WorkLine work={meetingWork(tasks.data, row.project.id, today)} />}
                  </span>
                </button>
                <div className="relative h-[4.5rem]">
                  {todayIn && <span aria-hidden style={todayAt} className="absolute inset-y-0 w-0.5 bg-ink/70" />}
                  <Bars row={row} span={span} drawing={drawing} index={index} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
