import { useEffect, useState } from 'react';
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

// The change channel has no event for its own state, so the banner looks again every few seconds, and at once when the browser
// goes offline or online.
const CHECK_MS = 3000;
// A channel joins at the start and joins again after a hidden tab. It counts as closed after this many checks in a row (6 s).
const CLOSED_CHECKS = 2;

/**
 * The connection (client map 6). The browser is offline: a change does not save, and the banner says so at once. The Realtime
 * channel of the change signals stays closed: the lists do not follow the changes of other people, but a change still saves over
 * HTTP, so the banner says only that live updates paused.
 */
function ConnectionBanner() {
  const { t } = useTranslation();
  const { changes } = useRuntime();
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [closedChecks, setClosedChecks] = useState(0);
  useEffect(() => {
    const look = () => setOffline(!navigator.onLine);
    window.addEventListener('online', look);
    window.addEventListener('offline', look);
    const timer = window.setInterval(() => {
      look();
      setClosedChecks((count) => (changes?.status() === 'closed' ? count + 1 : 0));
    }, CHECK_MS);
    return () => {
      window.removeEventListener('online', look);
      window.removeEventListener('offline', look);
      window.clearInterval(timer);
    };
  }, [changes]);
  const text = offline ? t('connection.lost') : closedChecks >= CLOSED_CHECKS ? t('connection.paused') : null;
  if (!text) return null;
  return (
    <div role="status" className="bg-fill px-4 py-2 text-center text-footnote text-label">
      {text}
    </div>
  );
}
