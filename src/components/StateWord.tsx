import type { ReactNode } from 'react';

const TONES = { attn: 'bg-attn-bg text-attn', late: 'bg-late-bg text-late', quiet: 'text-ink-2' } as const;

/** A small soft word that shows only when there is something to say (redesign spec 2.4). */
export function StateWord({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex min-h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-caption font-semibold ${TONES[tone]}`}>{children}</span>;
}
