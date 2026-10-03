import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastInput = {
  message: string;
  tone?: 'info' | 'error';
  /**
   * isUndo: Ctrl+Z or Cmd+Z runs the action of the newest such toast too (audit 2026-10-03, SHL-3).
   * It is required, so a new Undo toast cannot leave it out by mistake (audit 2026-10-03, V-1).
   */
  action?: { label: string; run: () => void; isUndo: boolean };
};
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null);
let nextToastId = 1;
const STAY_MS = 5000;

/** A text field keeps Ctrl+Z for the undo of its own typing. */
const isTextField = (target: EventTarget | null) =>
  target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;

/**
 * Toasts stay 5 seconds (spec 5.5). At most three show at once. The time stops while the pointer or the focus is on a toast,
 * so a person can read it and reach Undo (audit 2026-10-03, SHL-3).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const latest = useRef(toasts);
  latest.current = toasts;
  // Each toast's time left, and its running timer. While a toast is held (pointer or focus), no timer runs.
  const timers = useRef(new Map<number, { left: number; started: number; handle: number }>());
  const held = useRef({ pointer: false, focus: false });
  // The toast that holds the pointer or the focus, so its hold ends when it goes away (audit 2026-10-03, V-15).
  const holder = useRef<{ pointer: number | null; focus: number | null }>({ pointer: null, focus: null });
  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id)?.handle);
    timers.current.delete(id);
    setToasts((all) => all.filter((toast) => toast.id !== id));
  }, []);
  const run = useCallback((id: number, left: number) => {
    timers.current.set(id, { left, started: Date.now(), handle: window.setTimeout(() => dismiss(id), left) });
  }, [dismiss]);
  const show = useCallback((toast: ToastInput) => {
    const id = nextToastId++;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
    if (held.current.pointer || held.current.focus) timers.current.set(id, { left: STAY_MS, started: 0, handle: 0 });
    else run(id, STAY_MS);
  }, [run]);
  const hold = useCallback((what: 'pointer' | 'focus', on: boolean) => {
    const wasHeld = held.current.pointer || held.current.focus;
    held.current[what] = on;
    const isHeld = held.current.pointer || held.current.focus;
    if (isHeld === wasHeld) return;
    for (const [id, timer] of timers.current) {
      if (isHeld) {
        window.clearTimeout(timer.handle);
        timers.current.set(id, { left: Math.max(0, timer.left - (Date.now() - timer.started)), started: 0, handle: 0 });
      } else {
        run(id, timer.left);
      }
    }
  }, [run]);
  useEffect(() => {
    // Ctrl+Z or Cmd+Z runs the newest Undo, so a keyboard user never has to reach the toast in time.
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.defaultPrevented || isTextField(event.target)) return;
      const newest = [...latest.current].reverse().find((toast) => toast.action?.isUndo);
      if (!newest?.action) return;
      event.preventDefault();
      newest.action.run();
      dismiss(newest.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);
  useEffect(() => {
    // A toast that goes away under the pointer or with the focus sends no leave event, so its hold ends with it.
    for (const what of ['pointer', 'focus'] as const) {
      const id = holder.current[what];
      if (id !== null && !toasts.some((toast) => toast.id === id)) {
        holder.current[what] = null;
        hold(what, false);
      }
    }
    if (toasts.length === 0) held.current = { pointer: false, focus: false };
  }, [toasts, hold]);
  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer.handle);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* A live region: sheets hide the rest of the page from screen readers, but never a live region, so toasts stay heard. */}
      {/* data-toasts: a press here never counts as a press outside an open sheet (audit 2026-10-03, SHL-3). */}
      <div data-toasts aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            onPointerEnter={() => { holder.current.pointer = toast.id; hold('pointer', true); }}
            onPointerLeave={() => { holder.current.pointer = null; hold('pointer', false); }}
            onFocus={() => { holder.current.focus = toast.id; hold('focus', true); }}
            onBlur={() => { holder.current.focus = null; hold('focus', false); }}
            className="float pointer-events-auto flex min-h-11 max-w-full items-center gap-3 rounded-full px-5 py-2 text-subheadline text-ink"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                aria-keyshortcuts={toast.action.isUndo ? 'Control+Z Meta+Z' : undefined}
                className="pressable min-h-11 font-semibold text-link"
                onClick={() => {
                  toast.action?.run();
                  hold('focus', false);
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): { show: (toast: ToastInput) => void } {
  const context = useContext(ToastContext);
  if (!context) throw new Error('ToastProvider is missing.');
  return context;
}
