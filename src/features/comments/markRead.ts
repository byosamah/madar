import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatRow, CommentView } from '../../api/contract/views';
import { useRuntime } from '../../app/runtime';

/**
 * Comments read in a task panel or a task thread count as read in the Inbox too (audit 2026-10-03, SHL-5). The thread is marked
 * read when its comments load or change. A thread with no comments, or whose newest comment is the person's own, has nothing
 * unread, so it sends no mark: each mark is a change that reloads every list on the screen. One exception (fbk_028): a thread that the
 * person marked unread shows as unread in the Inbox list whoever wrote the newest comment, so opening it sends the mark and ends that
 * mark. The list in the cache says it. A failed mark shows no error.
 */
export function useMarkTaskRead(taskId: string | null, comments: CommentView[] | undefined, viewerId: string | undefined): void {
  const { api } = useRuntime();
  const queryClient = useQueryClient();
  const count = comments?.length ?? 0;
  const newestMine = comments?.at(-1)?.comment.authorId === viewerId;
  useEffect(() => {
    if (!taskId || count === 0) return;
    const markedUnread = queryClient.getQueryData<ChatRow[]>(['api', 'chats.list', {}])?.some((row) => row.id === taskId && row.unread > 0) ?? false;
    if (!newestMine || markedUnread) api.call('chats.markRead', { conversationId: taskId }).catch(() => undefined);
  }, [api, queryClient, taskId, count, newestMine]);
}
