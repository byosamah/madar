import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastInput = { message: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null);
let nextToastId = 1;

/** Toasts stay 5 seconds (spec 5.5). At most three show at once. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((toast) => toast.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextToastId++;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* A live region: sheets hide the rest of the page from screen readers, but never a live region, so toasts stay heard. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className="float pointer-events-auto flex min-h-11 max-w-full items-center gap-3 rounded-full px-5 py-2 text-subheadline text-ink"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="pressable min-h-11 font-semibold text-link"
                onClick={() => {
                  toast.action?.run();
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
