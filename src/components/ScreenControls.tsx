import type { ReactNode } from 'react';

/**
 * The row under the page title for the controls of a list: the Filter button of Projects, the To-dos and Meetings switch of Tasks. The
 * title block keeps 20 px under it (`ScreenTitle`), and this row keeps 16 px above the list. One component, so every screen with such a
 * row has the same space (owner, 2026-10-23). The parent of the row must have no gap of its own.
 */
export function ScreenControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 pb-4">{children}</div>;
}
