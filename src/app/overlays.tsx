import { lazyOverlay } from './lazyOverlay';
import { whenIdle } from './whenIdle';
import { warmTaskSheet } from '../features/home/HomeTaskSheet';

/**
 * The three parts of the shell that most sessions never open load in their own chunks (performance audit 2026-10-21, FL-4):
 * Focus mode, the feedback sheet and the sheet of an ended session. Each one mounts at its first use (`useOnceOn`) and stays
 * mounted, so its closing animation stays. `warmAtIdle` starts the imports after the first screen, so the first use finds
 * them in memory. The remote build splits them. The prototype keeps one script file, and the imports are plain references there.
 */
const focus = lazyOverlay(() => import('../features/focus/FocusMode').then((m) => m.FocusMode));
const feedback = lazyOverlay(() => import('../features/feedback/FeedbackSheet').then((m) => m.FeedbackSheet));
const expired = lazyOverlay(() => import('../features/auth/SessionExpiredSheet').then((m) => m.SessionExpiredSheet));

export const LazyFocusMode = focus.Overlay;
export const LazyFeedbackSheet = feedback.Overlay;
export const LazySessionExpiredSheet = expired.Overlay;

/** Starts the imports of the three shell parts when the browser is idle. */
export function warmAtIdle(): void {
  whenIdle(() => {
    focus.warm();
    feedback.warm();
    expired.warm();
  });
}

/**
 * Starts at once the import that the first address needs. A push link opens Home with ?task=, so the task panel loads next to
 * the first screens. An address with ?focus= opens Focus mode.
 */
export function warmForAddress(pathname: string, search: string): void {
  const params = new URLSearchParams(search);
  if (pathname === '/' && params.has('task')) warmTaskSheet();
  if (params.has('focus')) focus.warm();
}
