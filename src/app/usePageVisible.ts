import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/**
 * True while the tab shows (chat design 2026-10-19, item 5). An open chat marks its messages read only while this is true, so a
 * message that comes while the person looks at another tab stays unread until the tab shows again.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, () => !document.hidden, () => true);
}
