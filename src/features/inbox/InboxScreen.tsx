import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useAction, useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { Sheet } from '../../components/Sheet';
import { ChatList } from './ChatList';
import { ConversationPane } from './ConversationPane';

/** Starts a direct chat: a person is picked, and the chat opens. */
function NewMessage({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const users = useCall('users.list', {}, { enabled: open });
  const session = useCall('session.get', {}, { enabled: open });
  const meId = session.data?.authority.id;
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.id !== meId);
  const openChat = useAction('chats.openDirect', {
    onSuccess: ({ id }) => {
      onOpenChange(false);
      navigate(`/inbox/${id}`);
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('chat.pickPerson')}>
      {users.data && people.length === 0 && <p className="text-subheadline text-ink-2">{t('chat.noPeople')}</p>}
      <ul className="flex flex-col">
        {people.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              disabled={openChat.isPending}
              onClick={() => openChat.mutate({ userId: person.id })}
              className="pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start hover:bg-fill/50"
            >
              <Avatar user={person} size={36} />
              <span className="flex min-w-0 flex-col">
                <bdi className="truncate text-subheadline font-medium text-ink">{person.name}</bdi>
                <span className="truncate text-footnote text-ink-2">{person.discipline}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/**
 * The Inbox is a chat (owner, 2026-10-01). The chats sit on the start side and the open one beside them.
 * A phone shows the list, and a chat opens on its own at /inbox/:conversationId.
 */
export function InboxScreen() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const [picking, setPicking] = useState(false);
  const list = useCall('chats.list', {});
  const rows = list.data ?? [];
  const open = conversationId !== undefined;
  return (
    <>
      <div className={open ? 'max-sm:hidden' : undefined}>
        <ScreenTitle
          title={t('screens.inbox')}
          action={<Button className="shrink-0" onClick={() => setPicking(true)}>{t('chat.newMessage')}</Button>}
        />
      </div>
      <div className={`flex gap-4 ${open ? 'h-[calc(100dvh-9.5rem)] sm:h-[calc(100dvh-15rem)]' : 'h-[calc(100dvh-16rem)] sm:h-[calc(100dvh-15rem)]'} min-h-[26rem]`}>
        <aside className={`panel hairline flex w-full min-w-0 flex-col overflow-hidden sm:w-[340px] sm:shrink-0 ${open ? 'max-sm:hidden' : ''}`}>
          {list.error && <div className="p-3"><LoadFailed error={list.error} onRetry={() => void list.refetch()} /></div>}
          {list.data && rows.length === 0 && <div className="p-3"><EmptyState title={t('chat.emptyTitle')} body={t('chat.empty')} /></div>}
          {list.data && rows.length > 0 && <ChatList rows={rows} selectedId={conversationId} />}
        </aside>
        <section className={`panel hairline flex min-w-0 flex-1 flex-col overflow-hidden ${open ? '' : 'max-sm:hidden'}`}>
          {conversationId
            ? <ConversationPane id={conversationId} />
            : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div className="flex max-w-xs flex-col items-center gap-1.5">
                  <p className="text-headline text-ink">{t('chat.selectTitle')}</p>
                  <p className="text-subheadline text-ink-2">{t('chat.selectBody')}</p>
                </div>
              </div>
            )}
        </section>
      </div>
      <NewMessage open={picking} onOpenChange={setPicking} />
    </>
  );
}
