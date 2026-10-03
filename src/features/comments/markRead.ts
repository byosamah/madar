import { useEffect } from 'react';
import type { CommentView } from '../../api/contract/views';
import { useRuntime } from '../../app/runtime';

/**
 * Comments read in a task panel or a task thread count as read in the Inbox too (audit 2026-10-03, SHL-5). The thread is marked
 * read when its comments load or change. A thread with no comments, or whose newest comment is the person's own, has nothing
 * unread, so it sends no mark: each mark is a change that reloads every list on the screen. A failed mark shows no error.
 */
export function useMarkTaskRead(taskId: string | null, comments: CommentView[] | undefined, viewerId: string | undefined): void {
  const { api } = useRuntime();
  const count = comments?.length ?? 0;
  const newestMine = comments?.at(-1)?.comment.authorId === viewerId;
  useEffect(() => {
    if (taskId && count > 0 && !newestMine) api.call('chats.markRead', { conversationId: taskId }).catch(() => undefined);
  }, [api, taskId, count, newestMine]);
}
