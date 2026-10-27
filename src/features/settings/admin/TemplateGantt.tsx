import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_PREREQUISITES } from '../../../api/contract/limits';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { counted } from '../../../lib/grammar';
import { arrowStep } from '../../../lib/keys';
import { stageSpan, templateDays } from '../../../lib/projectPlan';
import { FormError } from '../../auth/AuthPage';
import { barOf, chartDays, dayAt, waitsThrough, weekStarts } from './ganttMath';
import { DAYS_MAX, draftPlanTemplate, moveStageStart, touchTask, wholeNumber, type DraftTask, type TemplateDraft } from './templateDraft';

/** One working day is this many pixels wide on the chart at least. "Fit" widens the chart to its box, "Zoom in" doubles it and more. */
const DAY_PX = 12;
const ZOOM_PX = 28;
/** One row is this many pixels high. Its bar sits in the middle. */
const ROW_PX = 40;
/** The height of the week numbers above the rows. */
const HEAD_PX = 24;

export type Kind = 'stage' | 'task';
/** One bar: `start` and `length` are whole working days from day 0. `base` is the own start of a stage, or the start of a task. */
export type Bar = { kind: Kind; id: string; start: number; length: number; base: number; flexible: boolean };
export type Row = { kind: Kind; id: string; label: string; bar: Bar | null };
/** The part that the person picked in the editor: a stage or a task. */
export type Picked = { kind: Kind; id: string };
type Mode = 'move' | 'end';
type Place = { start: number; length: number };
/** A press on a bar. `day0` is the working day under the pointer at the press. */
type Gesture = { mode: Mode; bar: Bar; day0: number };

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** The rows of the chart: one row for each stage, then its tasks. A part with no valid numbers has a row and no bar. */
export function rowsOf(draft: TemplateDraft): Row[] {
  const plan = draftPlanTemplate(draft);
  const rows: Row[] = [];
  draft.stages.forEach((stage, stageIndex) => {
    const planStage = plan.stages.find((part) => part.id === stage.id);
    const planTasks = plan.tasks.filter((part) => part.stageId === stage.id);
    const span = planStage ? stageSpan(planStage, planTasks) : null;
    const bar: Bar | null = span && span.end > span.start
      ? { kind: 'stage', id: stage.id, start: span.start, length: span.end - span.start, base: wholeNumber(stage.start) ?? span.start, flexible: false }
      : null;
    rows.push({ kind: 'stage', id: stage.id, label: stage.name.trim() || String(stageIndex + 1), bar });
    draft.tasks.filter((part) => part.stageId === stage.id).forEach((task: DraftTask, taskIndex) => {
      const placed = planTasks.find((part) => part.id === task.id);
      const taskBar: Bar | null = placed
        ? { kind: 'task', id: task.id, start: placed.startOffset, length: placed.durationDays, base: placed.startOffset, flexible: placed.flexible }
        : null;
      rows.push({ kind: 'task', id: task.id, label: task.title.trim() || String(taskIndex + 1), bar: taskBar });
    });
  });
  return rows;
}

/** The wait links of the draft: each link goes from the part that is waited for to the part that waits. */
function linksOf(draft: TemplateDraft): { from: string; to: string; kind: Kind }[] {
  const links: { from: string; to: string; kind: Kind }[] = [];
  for (const part of draft.tasks) for (const from of part.prerequisiteIds ?? []) links.push({ from, to: part.id, kind: 'task' });
  for (const part of draft.stages) for (const from of part.prerequisiteIds ?? []) links.push({ from, to: part.id, kind: 'stage' });
  return links;
}

/**
 * The template timeline (fbk_008 item 6; ADM-06 and ADM-07): the main view of the editor. One row for each stage, with its tasks
 * under it. A press on a name or a bar picks the part, and the editor shows its details beside the chart. A task bar moves when the
 * person drags it, and its end grip changes its length. The link dot and the grip show when a bar has the pointer, the focus, or the
 * pick (ADM-09). When the person drags a dot onto another bar of the same kind, that bar waits: the editor makes the link. A press on
 * a link picks the part that waits. The chart edits the draft of the editor, so Save stays in one place.
 */
export function TemplateGantt({ draft, onChange, onLink, selected, onSelect }: {
  draft: TemplateDraft;
  onChange: (draft: TemplateDraft) => void;
  /** A new wait from a drag: the editor links the parts, moves the waiting part when it starts too early, and offers Undo (ADM-08). */
  onLink: (kind: Kind, waitingId: string, neededId: string) => void;
  selected: Picked | null;
  onSelect: (part: Picked) => void;
}) {
  const { t } = useTranslation();
  const rtl = document.documentElement.dir === 'rtl';
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const dropLink = useRef<(() => void) | null>(null);
  const [preview, setPreview] = useState<(Place & { kind: Kind; id: string }) | null>(null);
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'in'>('fit');
  // The link listeners go away when the chart goes away.
  useEffect(() => () => dropLink.current?.(), []);

  const rows = rowsOf(draft);
  const bars = rows.flatMap((row) => (row.bar ? [row.bar] : []));
  const days = chartDays(Math.max(0, ...bars.map((bar) => bar.start + bar.length)));
  const links = linksOf(draft);
  const isPicked = (kind: Kind, id: string) => selected?.kind === kind && selected.id === id;
  const shown = (bar: Bar): Bar => (preview && preview.id === bar.id && preview.kind === bar.kind ? { ...bar, start: preview.start, length: preview.length } : bar);

  // The chart in pixels from its start side. In Arabic the start side is on the right.
  const width = () => track.current?.getBoundingClientRect().width ?? 0;
  const localX = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return 0;
    return rtl ? rect.right - clientX : clientX - rect.left;
  };
  // The drawing uses percent of the chart, counted from its start side. Arabic mirrors each x value.
  const X = (percent: number) => (rtl ? 100 - percent : percent);

  // A bar that the person drags or stretches gives the task days of its own, so the task is no longer fresh (fbk_031).
  const patchTask = (id: string, patch: Partial<DraftTask>) => {
    onChange({ ...draft, tasks: draft.tasks.map((part) => (part.id === id ? touchTask({ ...part, ...patch }) : part)) });
  };

  /** The place that a gesture gives at this pointer x. A stage moves as a whole, and a task keeps its days inside the chart. */
  const resolve = (gestureNow: Gesture, clientX: number): Place => {
    const { bar, mode } = gestureNow;
    const delta = dayAt(localX(clientX), width(), days) - gestureNow.day0;
    if (mode === 'end') return { start: bar.start, length: clamp(bar.length + delta, 1, Math.min(DAYS_MAX, days - bar.start)) };
    if (bar.kind === 'stage') return { start: bar.start + clamp(delta, -bar.start, days - bar.length - bar.start), length: bar.length };
    return { start: clamp(bar.start + delta, 0, days - bar.length), length: bar.length };
  };

  const press = (event: ReactPointerEvent<HTMLElement>, mode: Mode, bar: Bar) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, bar, day0: dayAt(localX(event.clientX), width(), days) };
  };
  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const now = gesture.current;
    if (!now) return;
    const { kind, id } = now.bar;
    const place = resolve(now, event.clientX);
    // The same place keeps the same preview, so the chart does not draw again.
    setPreview((prev) => (prev && prev.kind === kind && prev.id === id && prev.start === place.start && prev.length === place.length ? prev : { kind, id, ...place }));
  };
  /** Applies the new place of a bar to the draft: a stage moves with its tasks, a task changes its length or its start. Nothing changes for the same place. */
  const commit = (bar: Bar, mode: Mode, next: Place) => {
    if (next.start === bar.start && next.length === bar.length) return;
    if (bar.kind === 'stage') onChange(moveStageStart(draft, bar.id, bar.base + (next.start - bar.start)));
    else if (mode === 'end') patchTask(bar.id, { days: String(next.length) });
    else patchTask(bar.id, { start: String(next.start) });
  };
  const release = (event: ReactPointerEvent<HTMLElement>) => {
    const now = gesture.current;
    if (!now) return;
    gesture.current = null;
    setPreview(null);
    commit(now.bar, now.mode, resolve(now, event.clientX));
  };
  const cancel = () => {
    gesture.current = null;
    setPreview(null);
  };

  /** The arrow keys of a bar: one working day, or five with Shift. The step is forward in the time direction of the language. */
  const stepOf = (event: KeyboardEvent<HTMLElement>): number => arrowStep(event.key, rtl) * (event.shiftKey ? 5 : 1);
  const nudge = (bar: Bar, mode: Mode, step: number) => {
    if (bar.kind === 'stage') commit(bar, mode, { start: bar.start + Math.max(-bar.start, step), length: bar.length });
    else if (mode === 'end') commit(bar, mode, { start: bar.start, length: clamp(bar.length + step, 1, DAYS_MAX) });
    else commit(bar, mode, { start: Math.max(0, bar.start + step), length: bar.length });
  };
  const handlers = (mode: Mode, bar: Bar) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => press(event, mode, bar),
    onPointerMove: drag,
    onPointerUp: release,
    onPointerCancel: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect({ kind: bar.kind, id: bar.id });
        return;
      }
      const step = stepOf(event);
      if (step === 0) return;
      event.preventDefault();
      nudge(bar, mode, step);
    },
  });

  /** A press on a dot starts a link. The release on another bar of the same kind makes that bar wait for this one. */
  const startLink = (event: ReactPointerEvent<HTMLElement>, bar: Bar) => {
    event.stopPropagation();
    setProblem(null);
    const pointAt = (clientX: number, clientY: number) => {
      const rect = track.current?.getBoundingClientRect();
      const w = rect?.width ?? 0;
      return { x: w > 0 ? (localX(clientX) / w) * 100 : 0, y: rect ? clientY - rect.top - HEAD_PX : 0 };
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dropLink.current = null;
    };
    function onMove(moved: PointerEvent) {
      setDrawing({ from: bar.id, ...pointAt(moved.clientX, moved.clientY) });
    }
    function onUp(ended: PointerEvent) {
      stop();
      setDrawing(null);
      join(bar, ended.target);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dropLink.current = stop;
    setDrawing({ from: bar.id, ...pointAt(event.clientX, event.clientY) });
  };
  /** The bar under the release point makes the link, when it has the same kind and the link is new and allowed. */
  const join = (from: Bar, target: EventTarget | null) => {
    const part = target instanceof Element ? target.closest<HTMLElement>('[data-part]') : null;
    const to = part?.dataset.part;
    if (!to || part?.dataset.kind !== from.kind || to === from.id) return;
    const current = (from.kind === 'task' ? draft.tasks : draft.stages).find((item) => item.id === to);
    if (!current) return;
    const waits = current.prerequisiteIds ?? [];
    if (waits.includes(from.id)) return;
    if (waits.length >= MAX_PREREQUISITES) {
      setProblem(t('projectTemplates.linkLimit', { n: MAX_PREREQUISITES }));
      return;
    }
    const edges = new Map([...draft.tasks, ...draft.stages].map((item) => [item.id, item.prerequisiteIds ?? []] as const));
    if (waitsThrough(edges, from.id, to)) {
      setProblem(t('projectTemplates.loopLink'));
      return;
    }
    onLink(from.kind, to, from.id);
  };

  // The geometry of each bar in the chart: its row center, and its start and end in percent.
  const geometry = new Map<string, { y: number; left: number; end: number }>();
  rows.forEach((row, index) => {
    if (!row.bar) return;
    const at = barOf(shown(row.bar).start, shown(row.bar).length, days);
    geometry.set(row.id, { y: index * ROW_PX + ROW_PX / 2, left: at.left, end: at.left + at.width });
  });
  const drawingFrom = drawing ? geometry.get(drawing.from) : undefined;
  const linkPath = (x1: number, y1: number, x2: number, y2: number) => `M ${X(x1)} ${y1} H ${X((x1 + x2) / 2)} V ${y2} H ${X(x2)}`;

  const renderBar = (row: Row, bar: Bar) => {
    const at = barOf(shown(bar).start, shown(bar).length, days);
    const color = row.kind === 'stage' ? 'bg-chart-muted opacity-40' : bar.flexible ? 'bg-chart-muted' : 'bg-ink';
    const picked = isPicked(row.kind, row.id);
    // The grip and the dot show for the pointer, the focus and the pick. A stage bar has no grip: its tasks set its length.
    const reveal = `transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${picked ? 'opacity-100' : 'opacity-0'}`;
    return (
      <div data-part={row.id} data-kind={row.kind} className="group absolute inset-y-2" style={{ insetInlineStart: `${at.left}%`, width: `${at.width}%` }}>
        <span
          role="slider"
          tabIndex={0}
          data-bar={row.kind}
          aria-label={t('projectTemplates.startOfPart', { name: row.label })}
          aria-valuenow={shown(bar).start}
          aria-valuemin={0}
          onClick={() => onSelect({ kind: row.kind, id: row.id })}
          {...handlers('move', bar)}
          className={`absolute inset-0 touch-none cursor-grab rounded-full ${color} ${picked ? 'ring-2 ring-ink ring-offset-1 ring-offset-bg' : ''}`}
        />
        {row.kind === 'task' && (
          <span
            role="slider"
            tabIndex={0}
            aria-label={t('projectTemplates.endOfPart', { name: row.label })}
            aria-valuenow={shown(bar).length}
            aria-valuemin={0}
            {...handlers('end', bar)}
            className={`absolute inset-y-0 end-0 w-2 touch-none cursor-ew-resize rounded-full bg-ink/70 ${reveal}`}
          />
        )}
        <span
          data-link-from={row.id}
          aria-hidden
          onPointerDown={(event) => startLink(event, bar)}
          className={`absolute inset-y-0 -end-3 my-auto size-3 cursor-crosshair rounded-full bg-ink ${reveal}`}
        />
      </div>
    );
  };

  const length = templateDays(draftPlanTemplate(draft));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 max-w-prose text-footnote text-ink-2">{t('projectTemplates.timelineHint')}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-footnote text-ink-2">
          {length > 0 && <span className="font-semibold text-ink">{t('projectTemplates.length', { days: counted(t, 'projectTemplates.dayCount', length) })}</span>}
          {/* The legend shows a swatch of each bar, with no colour word: the colours change with the theme. */}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-5 rounded-full bg-chart-muted" />
            {t('projectTemplates.canStretch')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-5 rounded-full bg-ink" />
            {t('projectTemplates.keepsLength')}
          </span>
          <SegmentedControl
            label={t('projectTemplates.zoomLabel')}
            value={zoom}
            options={[{ value: 'fit', label: t('projectTemplates.fit') }, { value: 'in', label: t('projectTemplates.zoomIn') }]}
            onChange={setZoom}
          />
        </div>
      </div>
      {bars.length === 0 && <p role="status" className="text-footnote text-ink-2">{t('projectTemplates.timelineEmpty')}</p>}
      <FormError text={problem} />
      <div className="flex items-start gap-3">
        <div className="w-[13.75rem] shrink-0 pt-6">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              title={row.label}
              aria-pressed={isPicked(row.kind, row.id)}
              onClick={() => onSelect({ kind: row.kind, id: row.id })}
              className={`pressable flex h-10 w-full items-center rounded-lg pe-2 text-start hover:bg-fill ${isPicked(row.kind, row.id) ? 'bg-fill' : ''} ${row.kind === 'stage' ? 'ps-2' : 'ps-6'}`}
            >
              <bdi className={`truncate text-footnote ${row.kind === 'stage' ? 'font-semibold text-ink' : 'text-ink-2'}`}>{row.label}</bdi>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-2">
          <div ref={track} className="relative" style={{ width: '100%', minWidth: days * (zoom === 'in' ? ZOOM_PX : DAY_PX) }}>
            <div className="relative h-6">
              {weekStarts(days).map((day) => (
                <span key={day} aria-hidden style={{ insetInlineStart: `${(day / days) * 100}%` }} className="tabular absolute top-0 text-caption text-ink-2">{day}</span>
              ))}
            </div>
            <div className="relative" style={{ height: rows.length * ROW_PX }}>
              {weekStarts(days).map((day) => (
                <span key={day} aria-hidden style={{ insetInlineStart: `${(day / days) * 100}%` }} className="absolute inset-y-0 w-px bg-separator" />
              ))}
              {rows.map((row) => (
                <div key={row.id} data-row={row.kind} className={`relative h-10 ${isPicked(row.kind, row.id) ? 'bg-fill' : ''}`}>
                  {row.bar && renderBar(row, row.bar)}
                </div>
              ))}
              <svg
                aria-hidden
                viewBox={`0 0 100 ${rows.length * ROW_PX}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-ink-2"
              >
                {links.map((link) => {
                  const from = geometry.get(link.from);
                  const to = geometry.get(link.to);
                  if (!from || !to) return null;
                  const d = linkPath(from.end, from.y, to.left, to.y);
                  const name = `${link.from}>${link.to}`;
                  // The links of the picked part are darker, so the person sees what it waits for and what waits for it.
                  const dark = selected !== null && (selected.id === link.to || selected.id === link.from);
                  return (
                    <g key={name} className={dark ? 'text-ink' : undefined}>
                      <path d={d} fill="none" stroke="currentColor" strokeWidth={dark ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
                      <path
                        data-link={name}
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        vectorEffect="non-scaling-stroke"
                        className="pointer-events-auto cursor-pointer"
                        onClick={() => onSelect({ kind: link.kind, id: link.to })}
                      />
                    </g>
                  );
                })}
                {drawing && drawingFrom && (
                  <path
                    d={`M ${X(drawingFrom.end)} ${drawingFrom.y} L ${X(drawing.x)} ${drawing.y}`}
                    fill="none"
                    stroke="currentColor"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
