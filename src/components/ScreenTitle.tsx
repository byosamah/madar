import type { ReactNode } from 'react';

/** The page title (30 px) with an optional line under it and one optional action at the end (redesign spec 2.2). */
export function ScreenTitle({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-page-title text-ink [text-wrap:balance]">{title}</h1>
        {children && <div className="mt-1.5 text-subheadline text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}
