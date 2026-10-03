import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { groupClose } from '../../lib/schedule';
import type { DashboardData } from './Tiles';
import type { HealthValue } from '../../api/contract/entities';

// The marks that the meeting timeline and the office schedule share, so one mark has one color on both screens
// (audit 2026-10-03, DSH-14 and DSH-15).

type Row = DashboardData['schedule'][number];

/**
 * The color of the current stage says the state of the project, and nothing else (owner, 2026-10-02: the ADHD pass).
 * A quiet grey when on track or paused, an orange tint when at risk, solid red when late, so the problems are the loudest marks on the
 * screen. The project color stays on its tile.
 */
export function currentTone(paused: boolean, health: HealthValue): string {
  if (paused || health === 'on_track') return 'bg-ink-2 text-bg';
  // At risk is a soft orange tint with an orange edge, so it never looks like the solid red of late, in light or dark.
  return health === 'late' ? 'bg-red-text text-bg' : 'bg-attn-bg text-attn ring-2 ring-inset ring-attn';
}

export type StageKind = 'done' | 'current' | 'next';

/** A stage before the current one is done, and a stage after it is next. */
export const stageKind = (index: number, current: number): StageKind => (index < current ? 'done' : index === current ? 'current' : 'next');

export type Mark = { id: string; name: string; when: string; label: string; at: number };

// Two diamonds closer than this share one diamond, so every diamond keeps a 24 px space to press (WCAG 2.2).
const MARK_GAP_PX = 26;

/** One deadline diamond, or one diamond with a count for deadlines that sit close together. The names show on hover and on focus. */
function DeadlineMark({ group, place }: { group: Mark[]; place: string }) {
  const { t } = useTranslation();
  const at = group[0].at;
  const label = group.length === 1 ? group[0].label : `${t('dashboard.meeting.deadlineCount', { count: group.length })}: ${group.map((mark) => mark.label).join('; ')}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      style={{ insetInlineStart: `calc(${at}% - 12px)` }}
      // 24 px to press (WCAG 2.2 target size); the drawn diamond stays 12 px.
      className={`group absolute ${place} z-10 grid size-6 place-items-center rounded-sm outline-offset-2`}
    >
      {/* A deadline is a date, not a warning, so the diamond is quiet. The Late sign beside the name carries the warning.
          The edge in the panel color keeps a diamond clear where it sits on a grey stage bar. */}
      <span aria-hidden className="size-3 rotate-45 rounded-sm bg-ink-2 ring-2 ring-[var(--c-panel)]" />
      {group.length > 1 && (
        <span aria-hidden className="tabular absolute -end-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[11px] font-bold leading-none text-bg">
          {group.length}
        </span>
      )}
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-full mb-2 hidden w-max max-w-72 rounded-xl bg-ink px-3 py-1.5 text-start text-[16px] font-medium text-bg group-hover:block group-focus-visible:block ${at > 70 ? 'end-0' : 'start-0'}`}
      >
        {group.map((mark) => (
          <span key={mark.id} className="block">
            {mark.name}{group.length > 1 && <span className="tabular opacity-70"> · {mark.when}</span>}
          </span>
        ))}
      </span>
    </button>
  );
}

/**
 * The deadline diamonds of one row. The row measures its own width, so close deadlines share a diamond at every screen size.
 * `place` sets the height of the diamonds in the row.
 */
export function DeadlineMarks({ marks, place = 'bottom-px' }: { marks: Mark[]; place?: string }) {
  const ruler = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ruler.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const gap = width > 0 ? (MARK_GAP_PX / width) * 100 : 0;
  return (
    <>
      <span ref={ruler} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0" />
      {groupClose(marks, gap).map((group) => <DeadlineMark key={group[0].id} group={group} place={place} />)}
    </>
  );
}
