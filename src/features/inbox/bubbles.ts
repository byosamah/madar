import { replaceEqualDeep } from '@tanstack/react-query';
import { useRef } from 'react';
import type { CommentView } from '../../api/contract/views';
import type { Bubble } from './MessageBubble';

/**
 * One Bubble for each view, kept while the view object stays the same, so a bubble that did not change keeps its props and its memo
 * holds (performance audit 2026-10-07, RND-5). An edited message gets a new view, so a new bubble. The panes of the Inbox and the task
 * panel both use it.
 *
 * `keyOf` is for a page of messages that slides (performance audit 2026-10-21, RN-4). A new message moves the newest 200 by one, so every
 * view after the shift is a new object with the same content. The bubble is found again by its key, and it is reused only when
 * `replaceEqualDeep` says the new view equals the old one. A caller adds to the key what its bubble depends on besides the view.
 */
export function useBubbles<V extends object>(views: V[], toBubble: (view: V) => Bubble, resetKey?: string, keyOf?: (view: V) => string): Bubble[] {
  type Kept = { key: string | undefined; map: WeakMap<V, Bubble>; byKey: Map<string, { view: V; bubble: Bubble }> };
  const fresh = (key: string | undefined): Kept => ({ key, map: new WeakMap(), byKey: new Map() });
  const kept = useRef<Kept>(fresh(resetKey));
  if (kept.current.key !== resetKey) kept.current = fresh(resetKey);
  const { map, byKey } = kept.current;
  const out = views.map((view) => {
    let bubble = map.get(view);
    const key = keyOf?.(view);
    if (!bubble && key !== undefined) {
      const hit = byKey.get(key);
      if (hit && replaceEqualDeep(hit.view, view) === hit.view) bubble = hit.bubble;
    }
    if (!bubble) bubble = toBubble(view);
    map.set(view, bubble);
    if (key !== undefined) byKey.set(key, { view, bubble });
    return bubble;
  });
  // A message that left the page stays in the table for a while. Drop the old ones when the table is much longer than the page.
  if (keyOf && byKey.size > views.length + 250) {
    const live = new Set(views.map(keyOf));
    for (const key of byKey.keys()) if (!live.has(key)) byKey.delete(key);
  }
  return out;
}

/**
 * The bubble of a task comment. "mine" depends on the reader, so a caller that keeps its bubbles starts them again when the reader changes.
 * The reason of a date move or of a reopening is a quiet line, not a message of a person (fbk_027): it carries `reason` and no menu.
 */
export function bubbleOfComment(view: CommentView, me: string | undefined): Bubble {
  return {
    id: view.comment.id, author: view.author, actingFor: null, body: view.comment.body, files: view.files, createdAt: view.comment.createdAt,
    mine: view.author.id === me, edited: view.comment.editedAt !== null, namesMe: view.namesMe, reactions: view.comment.reactions, replyTo: view.replyTo,
    canEdit: view.canEdit && view.kind === 'message',
    ...((view.comment.mentions?.length ?? 0) > 0 ? { everyone: true as const } : {}),
    ...(view.kind === 'message' ? {} : { reason: { kind: view.kind, dates: view.comment.dates } }),
  };
}
