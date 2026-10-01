import type { Hue } from '../lib/projectColor';

/** A 4 px line in the project hue (redesign spec 2.4). */
export function ProgressLine({ value, hue, label, className = '' }: { value: number; hue: Hue; label: string; className?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={`block h-1 overflow-hidden rounded-full bg-fill ${className}`}>
      <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: `var(--p-${hue}-fg)` }} />
    </span>
  );
}
