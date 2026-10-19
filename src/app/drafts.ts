import { useEffect, useState } from 'react';
import { useCall } from './runtime';

/**
 * Half-written chat messages and comments, by chat, task or post, for each person in this browser (local storage, so a reload and a
 * closed tab keep them; chat design 2026-10-19, item 7). Each key holds the person's ID, and the drafts of a person go when another
 * person becomes current, so the next person in the browser never sees or sends them (audit 2026-10-03, V-22). A sign-out clears
 * every draft (`keepDraftsOf('')`). A draft of the old session store moves here on its first read. Picked files stay in memory only,
 * because a store cannot hold a file.
 */
const PREFIX = 'madar.draft.';
const storageKey = (userId: string, key: string) => `${PREFIX}${userId}.${key}`;
const pickedFiles = new Map<string, File[]>();

export function readDraft(userId: string, key: string): string {
  const name = storageKey(userId, key);
  try {
    const kept = window.localStorage.getItem(name);
    if (kept !== null) return kept;
  } catch { return ''; }
  // A draft that an older version wrote to the session store moves to the local store.
  try {
    const old = window.sessionStorage.getItem(name);
    if (old === null) return '';
    window.sessionStorage.removeItem(name);
    try { window.localStorage.setItem(name, old); } catch { /* blocked storage */ }
    return old;
  } catch { return ''; }
}

export function writeDraft(userId: string, key: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(storageKey(userId, key), text);
    else window.localStorage.removeItem(storageKey(userId, key));
  } catch { /* blocked storage */ }
}

export function readDraftFiles(userId: string, key: string): File[] | undefined {
  return pickedFiles.get(storageKey(userId, key));
}

export function writeDraftFiles(userId: string, key: string, files: File[]): void {
  if (files.length > 0) pickedFiles.set(storageKey(userId, key), files);
  else pickedFiles.delete(storageKey(userId, key));
}

/** Deletes every draft that is not of this person. A key with no person ID (from before this rule) goes too. */
export function keepDraftsOf(userId: string): void {
  const own = `${PREFIX}${userId}.`;
  for (const store of ['localStorage', 'sessionStorage'] as const) {
    try {
      const keys = Object.keys(window[store]);
      for (const key of keys) if (key.startsWith(PREFIX) && !key.startsWith(own)) window[store].removeItem(key);
    } catch { /* blocked storage */ }
  }
  for (const key of [...pickedFiles.keys()]) if (!key.startsWith(own)) pickedFiles.delete(key);
}

/** Typed text that writes through to the person's drafts, so it waits when its box unmounts. */
export function useDraftText(owner: string, key: string): [string, (next: string) => void] {
  const [text, setText] = useState(() => readDraft(owner, key));
  const set = (next: string) => {
    writeDraft(owner, key, next);
    setText(next);
  };
  return [text, set];
}

/** The person whose drafts show: the current person. Undefined while the session loads. */
export function useDraftOwner(): string | undefined {
  return useCall('session.get', {}).data?.user.id;
}

/** Keeps the drafts of the current person only. The app shell runs it, so a change of person drops the drafts of the one before. */
export function useDraftSweep(): void {
  const owner = useDraftOwner();
  useEffect(() => {
    if (owner) keepDraftsOf(owner);
  }, [owner]);
}
