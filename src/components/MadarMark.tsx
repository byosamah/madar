import type { CSSProperties } from 'react';

/** The pinwheel of the four doors (the "door" form of the project pictures in its four turns), in a box of 18 by 18. */
export const MADAR_DOORS = 'M8 0H0A8 8 0 0 0 8 8Z M18 8V0A8 8 0 0 0 10 8Z M10 18H18A8 8 0 0 0 10 10Z M0 10V18A8 8 0 0 0 8 10Z';

/**
 * The three lights of Next for you on the panel, placed as on the owner's canvas. Only tokens, so the dark theme takes its own
 * values of --glow-a, --glow-b, --glow-c and --c-panel.
 */
export const MADAR_GLOW = [
  'radial-gradient(62% 62% at 26% 24%, var(--glow-a) 0%, transparent 100%)',
  'radial-gradient(58% 58% at 80% 36%, var(--glow-b) 0%, transparent 100%)',
  'radial-gradient(64% 64% at 52% 86%, var(--glow-c) 0%, transparent 100%)',
  'var(--c-panel)',
].join(', ');

/**
 * The Madar logo (owner's choice "3 · Turning doors", 2026-10-04): a glow tile like a project picture (30% corners, the inset ink/10
 * ring, the form at 45% in ink at 0.86), with the lights of Next for you. The styles are inline, so the icon script
 * (scripts/icons/make-icons.tsx) renders the same tile with no Tailwind. Hidden from screen readers unless it has a label.
 * Never inside a project list, so nobody reads it as a project.
 */
export function MadarMark({ size = 34, label }: { size?: number; label?: string }) {
  const tile: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: size,
    height: size,
    borderRadius: '30%',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 10%, transparent)',
    background: MADAR_GLOW,
  };
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <span data-madar-mark="" style={tile} {...a11y}>
      <svg viewBox="0 0 18 18" aria-hidden="true" style={{ display: 'block', width: '45%', height: '45%', color: 'var(--c-ink)' }}>
        <path d={MADAR_DOORS} fill="currentColor" fillOpacity={0.86} />
      </svg>
    </span>
  );
}
