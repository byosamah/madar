import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_PREREQUISITES } from '../../../api/contract/limits';
import { Button } from '../../../components/Button';
import { Sheet } from '../../../components/Sheet';
import { stageSpan } from '../../../lib/projectPlan';
import { barOf, chartDays, dayAt, waitsThrough, weekStarts } from './ganttMath';
import { draftPlanTemplate, moveStageStart, wholeNumber, type DraftTask, type TemplateDraft } from './templateDraft';

/** One working day is this many pixels wide on the chart. */
const DAY_PX = 12;
/** One row is this many pixels high. Its bar sits in the middle. */
const ROW_PX = 36;
/** The height of the week numbers above the rows. */
const HEAD_PX = 24;
/** The longest task length, in working days. The server refuses a longer one. */
const MAX_DAYS = 365;

type Kind = 'stage' | 'task';
/** One bar: `start` and `length` are whole working days from day 0. `base` is the own start of a stage, or the start of a task. */
type Bar = { kind: Kind; id: string; start: number; length: number; base: number; flexible: boolean };
type Row = { kind: Kind; id: string; label: string; bar: Bar | null };
type Mode = 'move' | 'end';
type Place = { start: number; length: number };
/** A press on a bar. `day0` is the working day under the pointer at the press. */
type Gesture = { mode: Mode; bar: Bar; day0: number };
type Picked = { from: string; to: string; kind: Kind };

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** The rows of the chart: one row for each stage, then its tasks. A part with no valid numbers has a row and no bar. */
function rowsOf(draft: TemplateDraft): Row[] {
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

/** A part with its waits set to `ids`. The key goes when no wait is left, as the draft keeps it. */
function withWaits<T extends { prerequisiteIds?: string[] }>(part: T, ids: string[]): T {
  const next: { prerequisiteIds?: string[] } = { ...part };
  delete next.prerequisiteIds;
  if (ids.length > 0) next.prerequisiteIds = ids;
  return next as T;
}

/**
 * The template timeline (fbk_008 item 6): one row for each stage, with its tasks under it. A task bar moves when the person drags
 * it, and its end handle changes its length. When the person drags a dot at the end of a bar onto another bar of the same kind,
 * that bar waits. A click on a link and "Remove link" takes it away. The sheet edits the draft of the editor, so Save stays in
 * one place.
 */
export function TemplateGantt({ draft, onChange, onClose }: {
  draft: TemplateDraft; onChange: (draft: TemplateDraft) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const rtl = document.documentElement.dir === 'rtl';
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const dropLink = useRef<(() => void) | null>(null);
  const [preview, setPreview] = useState<(Place & { kind: Kind; id: string }) | null>(null);
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The link listeners go away when the sheet closes.
  useEffect(() => () => dropLink.current?.(), []);

  const rows = rowsOf(draft);
  const bars = rows.flatMap((row) => (row.bar ? [row.bar] : []));
  const days = chartDays(Math.max(0, ...bars.map((bar) => bar.start + bar.length)));
  const labels = new Map(rows.map((row) => [row.id, row.label]));
  const links = linksOf(draft);
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

  const patchTask = (id: string, patch: Partial<DraftTask>) => {
    onChange({ ...draft, tasks: draft.tasks.map((part) => (part.id === id ? { ...part, ...patch } : part)) });
  };
  const setWaits = (kind: Kind, id: string, ids: string[]) => {
    if (kind === 'task') onChange({ ...draft, tasks: draft.tasks.map((part) => (part.id === id ? withWaits(part, ids) : part)) });
    else onChange({ ...draft, stages: draft.stages.map((part) => (part.id === id ? withWaits(part, ids) : part)) });
  };

  /** The place that a gesture gives at this pointer x. A stage moves as a whole, and a task keeps its days inside the chart. */
  const resolve = (gestureNow: Gesture, clientX: number): Place => {
    const { bar, mode } = gestureNow;
    const delta = dayAt(localX(clientX), width(), days) - gestureNow.day0;
    if (mode === 'end') return { start: bar.start, length: clamp(bar.length + delta, 1, Math.min(MAX_DAYS, days - bar.start)) };
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
    setPreview({ kind: now.bar.kind, id: now.bar.id, ...resolve(now, event.clientX) });
  };
  const release = (event: ReactPointerEvent<HTMLElement>) => {
    const now = gesture.current;
    if (!now) return;
    gesture.current = null;
    setPreview(null);
    const next = resolve(now, event.clientX);
    const { bar } = now;
    if (next.start === bar.start && next.length === bar.length) return;
    if (bar.kind === 'stage') onChange(moveStageStart(draft, bar.id, bar.base + (next.start - bar.start)));
    else if (now.mode === 'end') patchTask(bar.id, { days: String(next.length) });
    else patchTask(bar.id, { start: String(next.start) });
  };
  const cancel = () => {
    gesture.current = null;
    setPreview(null);
  };

  /** The arrow keys of a bar: one working day, or five with Shift. The step is forward in the time direction of the language. */
  const stepOf = (event: KeyboardEvent<HTMLElement>): number => {
    const amount = event.shiftKey ? 5 : 1;
    if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) return amount;
    if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) return -amount;
    return 0;
  };
  const nudge = (bar: Bar, mode: Mode, step: number) => {
    if (bar.kind === 'stage') {
      const shift = Math.max(-bar.start, step);
      if (shift !== 0) onChange(moveStageStart(draft, bar.id, bar.base + shift));
      return;
    }
    if (mode === 'end') {
      const length = clamp(bar.length + step, 1, MAX_DAYS);
      if (length !== bar.length) patchTask(bar.id, { days: String(length) });
      return;
    }
    const start = Math.max(0, bar.start + step);
    if (start !== bar.start) patchTask(bar.id, { start: String(start) });
  };
  const handlers = (mode: Mode, bar: Bar) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => press(event, mode, bar),
    onPointerMove: drag,
    onPointerUp: release,
    onPointerCancel: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
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
    setWaits(from.kind, to, [...waits, from.id]);
  };
  const removePicked = () => {
    if (!picked) return;
    const current = (picked.kind === 'task' ? draft.tasks : draft.stages).find((item) => item.id === picked.to);
    if (current) setWaits(picked.kind, picked.to, (current.prerequisiteIds ?? []).filter((id) => id !== picked.from));
    setPicked(null);
  };
  const pickedLive = picked !== null && links.some((link) => link.from === picked.from && link.to === picked.to);

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
    return (
      <div data-part={row.id} data-kind={row.kind} className="absolute inset-y-2" style={{ insetInlineStart: `${at.left}%`, width: `${at.width}%` }}>
        <span
          role="slider"
          tabIndex={0}
          data-bar={row.kind}
          aria-label={t('projectTemplates.startOfPart', { name: row.label })}
          aria-valuenow={shown(bar).start}
          {...handlers('move', bar)}
          className={`absolute inset-0 touch-none cursor-grab rounded-full ${color}`}
        />
        {row.kind === 'task' && (
          <span
            role="slider"
            tabIndex={0}
            aria-label={t('projectTemplates.endOfPart', { name: row.label })}
            aria-valuenow={shown(bar).length}
            {...handlers('end', bar)}
            className="absolute inset-y-0 end-0 w-2 touch-none cursor-ew-resize rounded-full"
          />
        )}
        <span
          data-link-from={row.id}
          aria-hidden
          onPointerDown={(event) => startLink(event, bar)}
          className="absolute inset-y-0 -end-2.5 my-auto size-3 cursor-crosshair rounded-full bg-ink"
        />
      </div>
    );
  };

  return (
    <Sheet
      open
      wide
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('projectTemplates.timeline')}
      footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-footnote text-ink-2">{t('projectTemplates.timelineHint')}</p>
        {problem && <p role="alert" className="text-footnote text-late">{problem}</p>}
        {pickedLive && picked && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-fill p-2">
            <span dir="auto" className="min-w-0 text-footnote">
              {t('projectTemplates.waitingLink', { waiting: labels.get(picked.to) ?? '', needed: labels.get(picked.from) ?? '' })}
            </span>
            <Button onClick={removePicked}>{t('projectTemplates.removeLink')}</Button>
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="w-36 shrink-0 pt-6">
            {rows.map((row) => (
              <div key={row.id} className="flex h-9 items-center">
                <bdi className={`truncate text-footnote ${row.kind === 'stage' ? 'font-semibold' : 'ps-4 text-ink-2'}`}>{row.label}</bdi>
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto pb-2">
            <div ref={track} className="relative" style={{ width: days * DAY_PX }}>
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
                  <div key={row.id} data-row={row.kind} className="relative h-9">
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
                    return (
                      <g key={name}>
                        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                        <path
                          data-link={name}
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={12}
                          vectorEffect="non-scaling-stroke"
                          className="pointer-events-auto cursor-pointer"
                          onClick={() => setPicked({ from: link.from, to: link.to, kind: link.kind })}
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-footnote text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-5 rounded-full bg-chart-muted" />
            {t('projectTemplates.canStretch')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-5 rounded-full bg-ink" />
            {t('projectTemplates.keepsLength')}
          </span>
        </div>
      </div>
    </Sheet>
  );
}
