import { useTranslation } from 'react-i18next';
import { useAction } from '../../app/runtime';
import { useToast } from '../../app/toasts';

/**
 * Deletes a chat message for everyone, with no question, and says so with a short toast that has Undo (chat design 2026-10-19, item 11).
 * chats.deleteMessage writes no History event, so events.undo cannot take it back: the Undo of the toast calls it again with
 * "deleted: false", as useArchive does for chats.archive. The Undo shows no toast of its own, so it never chains into a second Undo.
 */
export function useDeleteMessage(): (id: string) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const call = useAction('chats.deleteMessage');
  const run = (id: string, deleted: boolean, announce = true) => {
    call.mutate({ id, deleted }, {
      onSuccess: () => {
        if (announce) toast.undo(t('chat.messageDeleted'), () => run(id, false, false));
      },
    });
  };
  return (id) => run(id, true);
}
