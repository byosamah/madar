import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { usePersonState } from '../../app/live/hooks';
import { usePersonName } from '../../app/personName';
import { useAction, useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { useRight } from '../../app/useRight';
import { PersonFace } from '../../components/PersonFace';
import { actorContext } from '../../lib/grammar';
import { chatState } from './chatBack';

export type PeopleMe = Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'> & { nameAr?: string | null };

/** The word of the state of one other person. It reads this person alone, so a change of another person renders nothing here. */
function StateWord({ person }: { person: UserCard }) {
  const { t } = useTranslation();
  const state = usePersonState(person.id);
  return <span className="truncate text-footnote text-ink-2">{t(`presence.${state}`, { context: actorContext(person) })}</span>;
}

/**
 * One row for each person of a group (UX audit 2026-10-19, chats-07): the face, the name, "You" on the own row and "Group maker" on the
 * row of the maker. The maker sees "Remove" on each other row, with a toast and Undo that adds the person back (chats-10).
 * `rich` is the row of the phone options sheet (Direction D): each row adds the word Online, Away or Offline, and a Message button that
 * opens the direct chat with that person. The own row says "Away (set by you)" when the person chose Away. The state words show only
 * with a live port, as the person menu does, and a person of kind agent gets no Message button. `onOpenChat` runs just before the
 * chat opens, so the sheet can close.
 */
export function PeopleRows({ id, people, me, makerId, rich = false, onOpenChat }: {
  id: string; people: UserCard[]; me: PeopleMe | undefined; makerId: string | null; rich?: boolean; onOpenChat?: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { live } = useRuntime();
  const session = useCall('session.get', {}, { enabled: rich });
  const update = useAction('chats.updateGroup');
  const openChat = useAction('chats.openDirect', {
    onSuccess: ({ id: chatId }) => {
      onOpenChat?.();
      void navigate(`/inbox/${chatId}`, { state: chatState(`${location.pathname}${location.search}`) });
    },
  });
  const isMaker = me !== undefined && me.id === makerId;
  // The Message button needs chat.direct (role rights version 2).
  const mayMessage = useRight('chat.direct');
  const members: Array<PeopleMe | UserCard> = [...(me ? [me] : []), ...people];
  const awayByHand = session.data?.user.preferences.awayByHand === true;
  const remove = (person: UserCard) => {
    update.mutate({ conversationId: id, remove: [person.id] }, {
      onSuccess: () => toast.undo(t('chat.removedToast', { name: nameOf(person) }), () => update.mutate({ conversationId: id, add: [person.id] })),
    });
  };
  return (
    <ul className="flex flex-col">
      {members.map((person) => {
        const mine = person.id === me?.id;
        const notes = [mine ? t('chat.you') : '', person.id === makerId ? t('chat.maker') : ''].filter(Boolean);
        const other = !mine ? (person as UserCard) : null;
        return (
          <li key={person.id} className="flex items-center gap-1">
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5">
              <PersonFace user={person} size={36} mine={rich && mine} />
              <span className="flex min-w-0 flex-col">
                <bdi className="truncate text-subheadline font-medium text-ink">{nameOf(person)}</bdi>
                {notes.length > 0 && <span className="truncate text-footnote text-ink-2">{notes.join(' · ')}</span>}
                {rich && live && other && <StateWord person={other} />}
                {rich && live && mine && awayByHand && <span className="truncate text-footnote text-ink-2">{t('presence.awayByYou', { context: actorContext(session.data?.user) })}</span>}
              </span>
            </div>
            {rich && other && other.kind === 'human' && mayMessage && (
              <button
                type="button"
                aria-label={t('chat.messagePerson', { name: nameOf(other) })}
                disabled={openChat.isPending}
                onClick={() => openChat.mutate({ userId: other.id })}
                className="pressable min-h-11 shrink-0 rounded-full bg-fill px-3 text-footnote font-medium text-ink disabled:opacity-40"
              >
                {t('person.message')}
              </button>
            )}
            {isMaker && other && (
              <button
                type="button"
                aria-label={t('chat.removeName', { name: nameOf(other) })}
                disabled={update.isPending}
                onClick={() => remove(other)}
                className="pressable min-h-11 shrink-0 rounded-full px-3 text-footnote font-medium text-late hover:bg-late-bg disabled:opacity-40"
              >
                {t('chat.remove')}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
