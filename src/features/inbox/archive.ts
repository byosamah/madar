import { useTranslation } from 'react-i18next';
import { useAction } from '../../app/runtime';
import { useToast } from '../../app/toasts';

/**
 * Archives a chat, or moves it back to the Inbox, and says so with a short toast that has Undo (UX audit 2026-10-19, chats-04 and
 * INT-14). chats.archive writes no History event, so events.undo cannot take it back: the Undo of the toast calls chats.archive again
 * with the other value. The archive marks the chat read, so Undo moves the chat back and does not bring the unread number back.
 */
export function useArchive(): (conversationId: string, archived: boolean) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const archive = useAction('chats.archive');
  // The Undo moves the chat the other way and shows no toast of its own, so Undo never chains into a second Undo.
  const run = (conversationId: string, archived: boolean, announce = true) => {
    archive.mutate({ conversationId, archived }, {
      onSuccess: () => {
        if (announce) toast.undo(t(archived ? 'chat.archivedToast' : 'chat.movedBackToast'), () => run(conversationId, !archived, false));
      },
    });
  };
  return (conversationId, archived) => run(conversationId, archived);
}
