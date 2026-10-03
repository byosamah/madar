import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOTE } from './mode';
import { useCall, useRuntime } from './runtime';

/** Spec 11.6: with no browser storage, the app runs in memory and says so. The real build says when it has no connection instead. */
export function StorageBanner() {
  return REMOTE ? <ConnectionBanner /> : <MemoryBanner />;
}

function MemoryBanner() {
  const { t } = useTranslation();
  const persistent = useCall('session.get', {}).data?.persistent;
  if (persistent !== false) return null;
  return (
    <div role="status" className="bg-fill px-4 py-2 text-center text-footnote text-label">
      {t('storage.notSaved')}
    </div>
  );
}

// The change channel has no event for its own state, so the banner looks again every few seconds and at once when the browser
// goes offline or online.
const CHECK_MS = 3000;

/**
 * "No connection" (client map 6): the browser is offline, or the Realtime channel of the change signals is closed. Then the
 * lists do not follow the changes of other people, and a change does not save.
 */
function ConnectionBanner() {
  const { t } = useTranslation();
  const { changes } = useRuntime();
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    const timer = window.setInterval(onChange, CHECK_MS);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
      window.clearInterval(timer);
    };
  }, []);
  const lost = useSyncExternalStore(subscribe, () => !navigator.onLine || changes?.status() === 'closed', () => false);
  if (!lost) return null;
  return (
    <div role="status" className="bg-fill px-4 py-2 text-center text-footnote text-label">
      {t('connection.lost')}
    </div>
  );
}
