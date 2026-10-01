import type { CSSProperties } from 'react';
import type { Hue } from '../lib/projectColor';

type Step = 'done' | 'now' | 'next' | 'full';

const STEP: Record<Step, string> = {
  done: 'step-in step-done',
  now: 'step-in step-now',
  next: 'bg-fill',
  full: 'step-in step-full',
};

const THICKNESS = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' } as const;

/**
 * Stage steps (owner's choice A, 2026-10-01): one piece per stage. Finished stages are soft, the current stage is full
 * color with a soft glow, the stages to come are grey. The pieces fill in one by one, then the current stage glows once.
 */
export function ProgressLine({
  index, total, hue, label, complete = false, size = 'sm', className = '',
}: { index: number; total: number; hue: Hue; label: string; complete?: boolean; size?: keyof typeof THICKNESS; className?: string }) {
  const count = Math.max(1, total);
  const current = Math.min(count - 1, Math.max(0, index));
  // The same value as before: (current stage + 1) / (stage count + 1), and full when the project is complete.
  const percent = complete ? 100 : Math.round(((current + 1) / (count + 1)) * 100);
  const stepOf = (i: number): Step => (complete ? 'full' : i < current ? 'done' : i === current ? 'now' : 'next');
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{ '--hue': `var(--p-${hue}-fg)` } as CSSProperties}
      className={`flex items-center gap-[3px] ${className}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-step={stepOf(i)} style={{ '--i': i } as CSSProperties} className={`block min-w-0 flex-1 rounded-full ${THICKNESS[size]} ${STEP[stepOf(i)]}`} />
      ))}
    </span>
  );
}
