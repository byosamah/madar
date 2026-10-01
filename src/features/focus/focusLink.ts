import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

// The link values that held the task panel before Focus mode, so "Exit focus" brings the panel back.
let returnTo: string | null = null;
// The control that opened Focus mode, so focus returns to it on exit.
let opener: HTMLElement | null = null;

/** Focus mode lives in the link (?focus=<task id>), over any screen (redesign spec 5.1). */
export function useFocusLink() {
  const [params, setParams] = useSearchParams();
  const taskId = params.get('focus');
  const open = useCallback((id: string) => setParams((current) => {
    returnTo = current.toString();
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    next.set('focus', id);
    return next;
  }), [setParams]);
  /** Exit returns to the task panel; after Done there is no panel to return to. */
  const close = useCallback((done = false) => setParams((current) => {
    const back = new URLSearchParams(returnTo ?? current.toString());
    returnTo = null;
    back.delete('focus');
    if (done) {
      back.delete('task');
      back.delete('project');
    }
    return back;
  }, { replace: true }), [setParams]);
  return { taskId, open, close };
}

/** Gives focus back to the control that opened Focus mode, when it is still on the page. */
export function returnFocus(): void {
  const target = opener;
  opener = null;
  window.setTimeout(() => {
    if (target?.isConnected) target.focus();
  }, 0);
}
