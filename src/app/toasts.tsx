import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { canRetry, errorMessage } from './errors';

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

/**
 * The presses that started on a toast. A sheet waits for the end of a press (the click) before it decides that a press was
 * outside it, and by then the toast of an Undo is gone from the page, so the sheet cannot ask the page. It asks here, with the
 * same pointerdown event (audit 2026-10-03, V-11).
 */
const toastPresses = new WeakSet<Event>();
export const isToastPress = (event: Event | undefined): boolean => event !== undefined && toastPresses.has(event);
let nextToastId = 1;
const STAY_MS = 5000;

/** Inputs that take no typing. A tick box, a radio or a button has nothing for Ctrl+Z to undo. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color', 'hidden']);

/** A text field keeps Ctrl+Z for the undo of its own typing. */
const isTextField = (target: EventTarget | null): boolean => {
  if (target instanceof HTMLInputElement) return !NOT_TYPED.has(target.type);
  return target instanceof Element && target.closest('textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
};

type Holder = { pointer: number | null; focus: number | null };
const isHeld = (holder: Holder) => holder.pointer !== null || holder.focus !== null;

/**
 * Toasts stay 5 seconds (spec 5.5). At most three show at once. The time stops while the pointer or the focus is on a toast,
 * so a person can read it and reach Undo (audit 2026-10-03, SHL-3).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const latest = useRef(toasts);
  latest.current = toasts;
  // Each toast's time left, and its running timer. While a toast holds the pointer or the focus, no timer runs.
  const timers = useRef(new Map<number, { left: number; started: number; handle: number }>());
  // The toast that holds the pointer or the focus, so its hold ends when it goes away (audit 2026-10-03, V-15).
  const holder = useRef<Holder>({ pointer: null, focus: null });
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
    if (isHeld(holder.current)) timers.current.set(id, { left: STAY_MS, started: 0, handle: 0 });
    else run(id, STAY_MS);
  }, [run]);
  /** The toast "id" now holds the pointer or the focus, or null when it lets go. */
  const hold = useCallback((what: keyof Holder, id: number | null) => {
    const wasHeld = isHeld(holder.current);
    holder.current[what] = id;
    const held = isHeld(holder.current);
    if (held === wasHeld) return;
    for (const [toastId, timer] of timers.current) {
      if (held) {
        window.clearTimeout(timer.handle);
        timers.current.set(toastId, { left: Math.max(0, timer.left - (Date.now() - timer.started)), started: 0, handle: 0 });
      } else {
        run(toastId, timer.left);
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
      if (id !== null && !toasts.some((toast) => toast.id === id)) hold(what, null);
    }
  }, [toasts, hold]);
  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer.handle);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* A live region: sheets hide the rest of the page from screen readers, but never a live region, so toasts stay heard. */}
      {/* A press here never counts as a press outside an open sheet: see isToastPress (audit 2026-10-03, V-11). */}
      <div aria-live="polite" onPointerDownCapture={(event) => toastPresses.add(event.nativeEvent)} className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            onPointerEnter={() => hold('pointer', toast.id)}
            onPointerLeave={() => hold('pointer', null)}
            onFocus={() => hold('focus', toast.id)}
            onBlur={() => hold('focus', null)}
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
                  hold('focus', null);
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

export type Toasts = {
  show: (toast: ToastInput) => void;
  /** A change that Undo takes back: the message and an Undo button. Ctrl+Z or Cmd+Z runs the newest one too. */
  undo: (message: string, run: () => void) => void;
  /**
   * A failed call: the text of the error, or the screen's own text when it says more (the name of a file). Retry shows only
   * when the screen gives "retry" and the same call may work again (canRetry).
   */
  failed: (error: unknown, options?: { retry?: () => void; message?: string }) => void;
};

/** The toasts, with the two kinds that most screens show written once (cleanup 2026-10-06). */
export function useToast(): Toasts {
  const context = useContext(ToastContext);
  if (!context) throw new Error('ToastProvider is missing.');
  const { t } = useTranslation();
  const { show } = context;
  return useMemo(() => ({
    show,
    undo: (message, run) => show({ message, action: { label: t('common.undo'), run, isUndo: true } }),
    failed: (error, { retry, message } = {}) => show({
      tone: 'error',
      message: message ?? errorMessage(error, t),
      action: retry && canRetry(error) ? { label: t('common.retry'), run: retry, isUndo: false } : undefined,
    }),
  }), [show, t]);
}
