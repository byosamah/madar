import type { ReactNode } from 'react';

/**
 * Start-aligned, one sentence and one action (spec 10.4 and 11.6). A state under a page title that already says the same
 * thing has no title of its own, so the words show once (audit 2026-10-03, V-34).
 */
export function EmptyState({ title, body, action }: { title?: string; body: string; action?: ReactNode }) {
  return (
    <section className="surface flex flex-col items-start gap-2 rounded-card p-6">
      {title && <h2 className="text-headline">{title}</h2>}
      <p className="text-subheadline text-label-2">{body}</p>
      {action}
    </section>
  );
}
