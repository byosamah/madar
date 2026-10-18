import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useByPersonName, usePersonName } from '../../app/personName';
import { useAction, useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { Sheet } from '../../components/Sheet';
import { ChatList } from './ChatList';
import { ConversationPane } from './ConversationPane';

/**
 * Starts a direct chat: a person is picked, and the chat opens with one tap. "Make a group" lets the person pick two people or
 * more: then a name field and "Make group" show (owner, 2026-10-18).
 */
function NewMessage({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const navigate = useNavigate();
  const users = useCall('users.list', {}, { enabled: open });
  const session = useCall('session.get', {}, { enabled: open });
  const meId = session.data?.authority.id;
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.id !== meId).sort(byName);
  const [grouping, setGrouping] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const openChat = useAction('chats.openDirect', {
    onSuccess: ({ id }) => {
      onOpenChange(false);
      navigate(`/inbox/${id}`);
    },
  });
  const makeGroup = useAction('chats.createGroup', {
    onSuccess: ({ id }) => {
      onOpenChange(false);
      navigate(`/inbox/${id}`);
    },
  });
  // A closed sheet starts again in one tap: no group is half picked when it opens next time.
  const close = (next: boolean) => {
    if (!next) {
      setGrouping(false);
      setPicked([]);
      setGroupName('');
    }
    onOpenChange(next);
  };
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const footer = !grouping ? undefined : picked.length < 2 ? <p className="text-footnote text-ink-2">{t('chat.pickHint')}</p> : (
    <div className="flex flex-col gap-3">
      <TextField id="new-group-name" label={t('chat.groupName')} value={groupName} onChange={(event) => setGroupName(event.target.value)} />
      <Button variant="primary" disabled={groupName.trim() === '' || makeGroup.isPending} onClick={() => makeGroup.mutate({ name: groupName.trim(), memberIds: picked })}>
        {t('chat.makeGroup')}
      </Button>
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={close} title={t('chat.pickPerson')} footer={footer}>
      {users.data && people.length === 0 && <p className="text-subheadline text-ink-2">{t('chat.noPeople')}</p>}
      {!grouping && people.length > 0 && <Button variant="plain" onClick={() => setGrouping(true)}>{t('chat.groupStart')}</Button>}
      <ul className="flex flex-col">
        {people.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              aria-pressed={grouping ? picked.includes(person.id) : undefined}
              disabled={!grouping && openChat.isPending}
              onClick={() => (grouping ? toggle(person.id) : openChat.mutate({ userId: person.id }))}
              className={`pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start hover:bg-fill/50 ${grouping && picked.includes(person.id) ? 'bg-fill' : ''}`}
            >
              <Avatar user={person} size={36} />
              <span className="flex min-w-0 flex-col">
                <bdi className="truncate text-subheadline font-medium text-ink">{nameOf(person)}</bdi>
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
