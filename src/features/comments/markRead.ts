import { useEffect, useRef } from 'react';
import type { CommentView } from '../../api/contract/views';
import { useRuntime } from '../../app/runtime';
import { usePageVisible } from '../../app/usePageVisible';

/**
 * Comments read in a task panel or a task thread count as read in the Inbox too (audit 2026-10-03, SHL-5). The thread is marked
 * read when its comments load or change, and only while the tab shows (chat design 2026-10-19, item 5): a thread is marked once for
 * each new count of comments, so a tab that only shows again sends no new mark. A thread with no comments, or whose newest comment is
 * the person's own, has nothing unread, so it sends no mark: each mark is a change that reloads every list on the screen. A failed
 * mark shows no error and is tried again at the next show.
 */
export function useMarkTaskRead(taskId: string | null, comments: CommentView[] | undefined, viewerId: string | undefined): void {
  const { api } = useRuntime();
  const visible = usePageVisible();
  const count = comments?.length ?? 0;
  const newestMine = comments?.at(-1)?.comment.authorId === viewerId;
  // The thread and the count that were marked last. A failed mark clears it, so the next show tries again.
  const marked = useRef<{ taskId: string; count: number } | null>(null);
  useEffect(() => {
    if (!taskId || !visible || count === 0 || newestMine) return;
    if (marked.current?.taskId === taskId && marked.current.count === count) return;
    const sent = { taskId, count };
    marked.current = sent;
    api.call('chats.markRead', { conversationId: taskId }).catch(() => {
      if (marked.current === sent) marked.current = null;
    });
  }, [api, taskId, count, newestMine, visible]);
}
