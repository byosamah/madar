import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

/** The parts of the link that belong to a panel. The first one says whether the panel is open. */
export const TASK_PANEL = ['task', 'thread'] as const;
export const PAYMENT_PANEL = ['payment'] as const;
export const ENTRY_PANEL = ['entry'] as const;

type Mark = { panelClose?: string } | null;

const without = (search: string, keys: readonly string[]): string => {
  const next = new URLSearchParams(search);
  for (const key of keys) next.delete(key);
  return next.toString();
};

/**
 * Open and close of a panel that lives in the link: the task panel, the payment sheet and the Tracker entry sheet. Open adds one history step, so
 * Back closes the panel. That step remembers the link that Close leads to. Close goes back over the step when it leads
 * exactly there, so a panel a person looked at costs no extra Back. A panel that came with the link (a reload, a shared
 * link), or a link that changed in between, closes the old way: Close replaces the link (audit 2026-10-03, PRJ-9, V-36).
 */
export function usePanelLink(keys: readonly string[]) {
  const [, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // The step that a Close already goes back from, so a second Close before the Back lands does not leave the screen.
  const goingBack = useRef<string | null>(null);
  // Forward brings a step back with its old key. Forget the guard when the link moves on, so Close works there again
  // (audit 2026-10-03, V-36).
  useEffect(() => {
    goingBack.current = null;
  }, [location.key]);
  const open = useCallback((values: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    // A panel opened over an open one takes its place and keeps the step, so one Back or one Close leaves both.
    if (new URLSearchParams(location.search).has(keys[0])) setParams(next, { replace: true, state: location.state });
    else setParams(next, { state: { panelClose: without(location.search, keys) } });
  }, [keys, location, setParams]);
  const close = useCallback(() => {
    if (goingBack.current === location.key) return;
    const target = without(location.search, keys);
    if ((location.state as Mark)?.panelClose === target) {
      goingBack.current = location.key;
      navigate(-1);
    } else setParams(new URLSearchParams(target), { replace: true });
  }, [keys, location, navigate, setParams]);
  return { open, close };
}

