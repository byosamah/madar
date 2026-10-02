import { useEffect } from 'react';

type Sentinel = { release: () => Promise<void>; addEventListener?: (type: 'release', listener: () => void) => void };

/**
 * Keeps the screen awake while the page is open and visible. The browser drops the lock when the page hides,
 * so the hook asks again when the page shows. A missing API or a refusal does nothing.
 */
export function useWakeLock() {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!api) return;
    let lock: Sentinel | null = null;
    let closed = false;
    // True from the request until it answers, so two calls never ask at once.
    let pending = false;
    const acquire = async () => {
      if (closed || lock || pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const next = await api.request('screen');
        if (closed) {
          void next.release().catch(() => undefined);
        } else {
          lock = next;
          // The browser releases a screen lock by itself when the page hides.
          next.addEventListener?.('release', () => { if (lock === next) lock = null; });
        }
      } catch {
        // The browser or the battery setting said no. The meeting goes on without the lock.
      } finally {
        pending = false;
      }
    };
    const onVisible = () => {
      // A held lock stays. A lock the browser released has cleared itself, so this asks again.
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisible);
      const held = lock;
      lock = null;
      void held?.release().catch(() => undefined);
    };
  }, []);
}
