import { lazyOverlay } from './lazyOverlay';
import { whenIdle } from './whenIdle';
import { warmTaskSheet } from '../features/home/HomeTaskSheet';

/**
 * The four parts of the shell that most sessions never open load in their own chunks (performance audit 2026-10-21, FL-4):
 * Focus mode, the feedback sheet, the sheet of an ended session and the panel of the person menu. The first three mount at their
 * first use (`useOnceOn`) and stay mounted, so their closing animation stays. The menu panel mounts at each open. `warmAtIdle`
 * starts the imports after the first screen, so the first use finds them in memory. The remote build splits them. The prototype keeps one script file, and the imports are plain references there.
 */
const focus = lazyOverlay(() => import('../features/focus/FocusMode').then((m) => m.FocusMode));
const feedback = lazyOverlay(() => import('../features/feedback/FeedbackSheet').then((m) => m.FeedbackSheet));
const expired = lazyOverlay(() => import('../features/auth/SessionExpiredSheet').then((m) => m.SessionExpiredSheet));
const personMenuPanel = lazyOverlay(() => import('./PersonMenuPanel').then((m) => m.PersonMenuPanel));

export const LazyFocusMode = focus.Overlay;
export const LazyFeedbackSheet = feedback.Overlay;
export const LazySessionExpiredSheet = expired.Overlay;
export const LazyPersonMenuPanel = personMenuPanel.Overlay;

/** Starts the import of the person menu panel. The picture calls it at pointerdown and at focus. */
export const warmPersonMenuPanel = personMenuPanel.warm;

/** Resolves when the person menu panel is in memory. The test helpers await it, so the first menu opens with no wait. */
export const loadPersonMenuPanel = personMenuPanel.ready;

/** Starts the imports of the four shell parts when the browser is idle. */
export function warmAtIdle(): void {
  whenIdle(() => {
    focus.warm();
    feedback.warm();
    expired.warm();
    personMenuPanel.warm();
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
