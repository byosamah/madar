import { useRef } from 'react';
import type { CommentView } from '../../api/contract/views';
import type { Bubble } from './MessageBubble';

/**
 * One Bubble for each view, kept while the view object stays the same, so a bubble that did not change keeps its props and its memo
 * holds (performance audit 2026-10-07, RND-5). An edited message gets a new view, so a new bubble. The panes of the Inbox and the task
 * panel both use it.
 */
export function useBubbles<V extends object>(views: V[], toBubble: (view: V) => Bubble, resetKey?: string): Bubble[] {
  const kept = useRef<{ key: string | undefined; map: WeakMap<V, Bubble> }>({ key: resetKey, map: new WeakMap() });
  if (kept.current.key !== resetKey) kept.current = { key: resetKey, map: new WeakMap() };
  const { map } = kept.current;
  return views.map((view) => {
    let bubble = map.get(view);
    if (!bubble) {
      bubble = toBubble(view);
      map.set(view, bubble);
    }
    return bubble;
  });
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
    ...(view.kind === 'message' ? {} : { reason: { kind: view.kind, dates: view.comment.dates } }),
  };
}
