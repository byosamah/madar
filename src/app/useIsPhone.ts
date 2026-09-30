import { useSyncExternalStore } from 'react';

const PHONE = '(max-width: 639px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True under 640 px (spec 10.9). Sheets and the schedule change shape on a phone. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}
