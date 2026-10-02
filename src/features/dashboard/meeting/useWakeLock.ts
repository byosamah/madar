import { useEffect } from 'react';

type Sentinel = { release: () => Promise<void> };

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
    const acquire = async () => {
      if (closed || lock || document.visibilityState === 'hidden') return;
      try {
        const next = await api.request('screen');
        if (closed) void next.release().catch(() => undefined);
        else lock = next;
      } catch {
        // The browser or the battery setting said no. The meeting goes on without the lock.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // The browser released the old lock when the page hid.
        lock = null;
        void acquire();
      }
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
