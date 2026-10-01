import type { ReactNode } from 'react';
import type { ProjectStatus } from '../api/contract/entities';

export type SignState = 'on_track' | 'at_risk' | 'late' | 'paused' | 'completed' | 'archived' | 'active';

const COLOR: Partial<Record<SignState, string>> = { on_track: 'text-green-text', at_risk: 'text-orange-text', late: 'text-red-text' };

/** The shape for each state, so the color never carries the meaning alone. */
function Glyph({ state }: { state: SignState }) {
  const shape = (() => {
    switch (state) {
      case 'on_track': return <circle cx="5.5" cy="5.5" r="4.6" fill="currentColor" />;
      case 'at_risk': return <><circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 1.5A4 4 0 0 0 5.5 9.5Z" fill="currentColor" /></>;
      case 'late': return <path d="M5.5.7 10.3 10H.7Z" fill="currentColor" strokeLinejoin="round" />;
      case 'paused': return <><rect x="2" y="1.4" width="2.4" height="8.2" rx=".9" fill="currentColor" /><rect x="6.6" y="1.4" width="2.4" height="8.2" rx=".9" fill="currentColor" /></>;
      case 'completed': return <><circle cx="5.5" cy="5.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m3.3 5.6 1.5 1.5 2.9-2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>;
      case 'archived': return <rect x="1.3" y="1.3" width="8.4" height="8.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />;
      default: return <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />;
    }
  })();
  return <svg viewBox="0 0 11 11" aria-hidden="true" className={`size-[11px] shrink-0 ${COLOR[state] ?? ''}`}>{shape}</svg>;
}

/**
 * A project's state as a small sign and a word (owner's choice "Shape signs", 2026-10-01): the shape carries the color,
 * the word stays in ink. No pill and no tinted fill, so the screen stays calm.
 */
export function StatusSign({ state, children }: { state: SignState; children: ReactNode }) {
  const loud = state in COLOR;
  return (
    <span data-sign={state} className={`inline-flex min-h-6 shrink-0 items-center gap-1.5 whitespace-nowrap text-caption font-semibold ${loud ? 'text-ink' : 'text-ink-2'}`}>
      <Glyph state={state} />
      {children}
    </span>
  );
}

/** The sign for a project that is not active: paused, completed or archived. */
export const signOfStatus = (status: ProjectStatus): SignState => (status === 'on_hold' ? 'paused' : status);

/** The sign for any project: its health while it is active, else its status. */
export const signOf = (health: { value: 'on_track' | 'at_risk' | 'late' } | null, status: ProjectStatus): SignState => (health ? health.value : signOfStatus(status));

/** The color of each state, for the sign and for the progress line (owner, 2026-10-01: the line takes the status color). */
export const SIGN_COLOR: Record<SignState, string> = {
  on_track: 'var(--c-green-text)', at_risk: 'var(--c-orange-text)', late: 'var(--c-red-text)',
  paused: 'var(--c-ink-2)', completed: 'var(--c-ink-2)', archived: 'var(--c-ink-2)', active: 'var(--c-ink-2)',
};
