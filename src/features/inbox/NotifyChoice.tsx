import { useTranslation } from 'react-i18next';
import type { NotifyLevel } from '../../api/contract/entities';
import { useAction } from '../../app/runtime';
import type { MenuItem } from '../../components/Menu';

/**
 * The "Notify me" part of the header menu of a chat (chat design item 21): a heading and two radio items, "All messages" and "Only when
 * I am named", with the line that says the unread count still shows every message. A pick of the other level saves it for this person
 * and this chat (chats.setNotify). A pick of the level that is checked sends nothing. A task thread has no choice, so TaskPane does
 * not call this. The items go after Archive (the `extra` items of ArchiveMenu and GroupMenu).
 */
export function useNotifyItems(chatId: string, level: NotifyLevel): MenuItem[] {
  const { t } = useTranslation();
  const setNotify = useAction('chats.setNotify');
  const pick = (notify: NotifyLevel) => {
    if (notify !== level) setNotify.mutate({ conversationId: chatId, notify });
  };
  return [
    { label: t('chat.notifyAll'), heading: t('chat.notify'), checked: level === 'all', onSelect: () => pick('all') },
    { label: t('chat.notifyNamed'), checked: level === 'named', note: t('chat.notifyNote'), onSelect: () => pick('named') },
  ];
}
