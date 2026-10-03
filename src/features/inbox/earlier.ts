import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageView } from '../../api/contract/views';
import { errorMessage } from '../../app/errors';
import { useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';

/**
 * The size of one page of chats.messages: its default limit (MESSAGE_PAGE in src/api/chatState.ts, which the screens do not
 * import, so the real build carries no fake API code). A page shorter than this is the first page of the chat.
 */
export const EARLIER_PAGE = 200;

/**
 * The earlier pages of a chat (plan 4.13, A5). `newest` is the page of chats.messages that the screen keeps fresh. The earlier
 * pages come one at a time, with the id of the oldest shown message, and go above it. When a new message pushes a message out
 * of the newest page, that message stays in the earlier ones, so no gap opens between them.
 */
export function useEarlierMessages(conversationId: string, newest: MessageView[] | undefined) {
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  const [older, setOlder] = useState<MessageView[]>([]);
  const [ended, setEnded] = useState(false);
  const [pending, setPending] = useState(false);
  const [seen, setSeen] = useState(newest);
  if (newest !== seen) {
    setSeen(newest);
    if (older.length > 0 && seen && newest) {
      const kept = new Set(newest.map((view) => view.message.id));
      const left = seen.filter((view) => !kept.has(view.message.id));
      if (left.length > 0) setOlder([...older, ...left]);
    }
  }
  const page = newest ?? [];
  const inPage = new Set(page.map((view) => view.message.id));
  const messages = [...older.filter((view) => !inPage.has(view.message.id)), ...page];
  const more = !ended && (older.length > 0 || page.length >= EARLIER_PAGE);

  const load = async () => {
    const oldest = messages[0];
    if (!oldest || pending) return;
    setPending(true);
    try {
      const answer = await api.call('chats.messages', { conversationId, before: oldest.message.id, limit: EARLIER_PAGE });
      setOlder((now) => [...answer.messages, ...now]);
      if (answer.messages.length < EARLIER_PAGE) setEnded(true);
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setPending(false);
    }
  };

  return { messages, earlier: more ? { load, pending } : undefined };
}
