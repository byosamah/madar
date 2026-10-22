import { useCallback, useState, useSyncExternalStore } from 'react';
import { readDraft, useDraftOwner, writeDraft } from '../../../app/drafts';

/**
 * The text of the update box of one project on a phone (phone D). The box sits on Overview, so a trip to another tab unmounts it.
 * The text lives in this module while the page is open, and in the draft store (`post:<project>`) for a reload. A browser that
 * blocks storage still keeps the text for the visit. Every reader of the same person and project sees one text at once, so the
 * header button and the box agree.
 */
const live = new Map<string, string>();
const listeners = new Set<() => void>();
const keyOf = (owner: string, projectId: string) => `${owner}|${projectId}`;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Forgets the text held in memory. The draft store keeps its copy. */
export function clearLivePostDrafts(): void {
  live.clear();
  for (const listener of [...listeners]) listener();
}

/**
 * `persist` true: the text is shared by every reader for this person and project and is kept as a draft.
 * `persist` false: plain local state (the box of a desk keeps today's behaviour).
 */
export function usePostDraft(projectId: string, persist: boolean): [string, (next: string) => void] {
  const owner = useDraftOwner() ?? '';
  const key = keyOf(owner, projectId);
  const shared = useSyncExternalStore(
    subscribe,
    () => live.get(key) ?? readDraft(owner, `post:${projectId}`),
    () => '',
  );
  const [local, setLocal] = useState('');
  const setShared = useCallback((next: string) => {
    live.set(key, next);
    writeDraft(owner, `post:${projectId}`, next);
    for (const listener of [...listeners]) listener();
  }, [key, owner, projectId]);
  return persist ? [shared, setShared] : [local, setLocal];
}
