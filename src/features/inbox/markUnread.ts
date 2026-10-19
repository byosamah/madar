import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useAction, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';

/**
 * Marks a chat or a task thread as unread again, and says so with a short toast that has Undo (fbk_028, owner 2026-10-19). The person
 * marks a chat that they read, to come back to it later: its row is bold again and counts in the Inbox badge until they open it again.
 * The chat that is open closes when the person marks it, so the list shows what they marked (on a phone, the list is the screen they
 * go back to). chats.markUnread writes no History event, so events.undo cannot take it back: the Undo of the toast reads the chat.
 * The hook lives in the Inbox screen, which stays while the chat closes, so the toast comes also for the chat that was open.
 */
export function useMarkUnread(): (conversationId: string) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { conversationId: open } = useParams();
  const { api } = useRuntime();
  const mark = useAction('chats.markUnread');
  return (conversationId) => {
    mark.mutate({ conversationId }, {
      onSuccess: () => {
        toast.undo(t('chat.markedUnreadToast'), () => {
          api.call('chats.markRead', { conversationId }).catch(() => undefined);
        });
        if (conversationId === open) navigate('/inbox');
      },
    });
  };
}
