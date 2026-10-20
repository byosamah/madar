import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { useByPersonName, usePersonName } from '../../app/personName';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../components/icons/animated/check';
import { Sheet } from '../../components/Sheet';

/** The sheets of a group: the people (with add, remove and leave), the name, adding people, and leaving. */
export type GroupMode = 'people' | 'rename' | 'add' | 'leave';

type Me = Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'> & { nameAr?: string | null };

/**
 * The people of a group (UX audit 2026-10-19, chats-07): every member sees who is in the group, on every device. "You" marks the
 * own row, "Group maker" the row of the person who acts as the maker. "Add people" is at the top, the maker sees "Remove" on each
 * other row, and "Leave group" is at the end. A removal shows a toast with Undo, which adds the person back (chats-10).
 */
function PeopleSheet({ id, people, me, makerId, onMode, onClose }: {
  id: string; people: UserCard[]; me: Me | undefined; makerId: string | null; onMode: (mode: GroupMode) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const toast = useToast();
  const update = useAction('chats.updateGroup');
  const isMaker = me !== undefined && me.id === makerId;
  const members: Array<Me | UserCard> = [...(me ? [me] : []), ...people];
  const remove = (person: UserCard) => {
    update.mutate({ conversationId: id, remove: [person.id] }, {
      onSuccess: () => toast.undo(t('chat.removedToast', { name: nameOf(person) }), () => update.mutate({ conversationId: id, add: [person.id] })),
    });
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('chat.peopleTitle')}
      description={t('chat.people', { count: members.length })}
      footer={<Button variant="destructive" onClick={() => onMode('leave')}>{t('chat.leaveGroup')}</Button>}
    >
      <Button variant="plain" onClick={() => onMode('add')}>{t('chat.addPeople')}</Button>
      <ul className="flex flex-col">
        {members.map((person) => {
          const mine = person.id === me?.id;
          const notes = [mine ? t('chat.you') : '', person.id === makerId ? t('chat.maker') : ''].filter(Boolean);
          const other = !mine ? (person as UserCard) : null;
          return (
            <li key={person.id} className="flex items-center gap-1">
              <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5">
                <Avatar user={person} size={36} />
                <span className="flex min-w-0 flex-col">
                  <bdi className="truncate text-subheadline font-medium text-ink">{nameOf(person)}</bdi>
                  {notes.length > 0 && <span className="truncate text-footnote text-ink-2">{notes.join(' · ')}</span>}
                </span>
              </div>
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
    </Sheet>
  );
}

/** The sheet that renames the group. */
function RenameSheet({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useAction('chats.updateGroup', { onSuccess: () => onClose() });
  const [field, setField] = useState(name);
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('chat.renameTitle')}
      footer={<Button variant="primary" disabled={field.trim() === '' || update.isPending} onClick={() => update.mutate({ conversationId: id, name: field.trim() })}>{t('common.save')}</Button>}
    >
      <TextField id="group-rename" label={t('chat.groupName')} autoComplete="off" maxLength={60} value={field} onChange={(event) => setField(event.target.value)} />
    </Sheet>
  );
}

/** The sheet that adds people. A line under the title says that they read the earlier messages too (UX audit 2026-10-19, chats-10). */
function AddSheet({ id, people, meId, onClose }: { id: string; people: UserCard[]; meId: string | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const users = useCall('users.list', {});
  const update = useAction('chats.updateGroup', { onSuccess: () => onClose() });
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (userId: string) => setPicked((list) => (list.includes(userId) ? list.filter((item) => item !== userId) : [...list, userId]));
  const members = new Set([...people.map((person) => person.id), ...(meId ? [meId] : [])]);
  const candidates = (users.data ?? []).filter((user) => user.kind === 'human' && user.active && !members.has(user.id)).sort(byName);
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('chat.addTitle')}
      description={t('chat.addNote')}
      footer={<Button variant="primary" disabled={picked.length === 0 || update.isPending} onClick={() => update.mutate({ conversationId: id, add: picked })}>{t('common.add')}</Button>}
    >
      <ul className="flex flex-col">
        {candidates.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              aria-pressed={picked.includes(person.id)}
              onClick={() => toggle(person.id)}
              className={`pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start hover:bg-fill/50 ${picked.includes(person.id) ? 'bg-fill' : ''}`}
            >
              <Avatar user={person} size={36} />
              <bdi className="truncate text-subheadline font-medium text-ink">{nameOf(person)}</bdi>
              {picked.includes(person.id) && <AnimatedIcon icon={CheckIcon} size={20} aria-hidden className="ms-auto size-5 shrink-0 text-accent" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/**
 * The confirm of leaving (UX audit 2026-10-19, chats-10): it says exactly what is lost, Cancel has the focus, and the confirm sits on
 * the start side, away from the pointer (the pattern of the Admin Remove sheet). After the leave a toast names the group.
 */
function LeaveSheet({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const leave = useAction('chats.leaveGroup', {
    onSuccess: () => {
      onClose();
      navigate('/inbox');
      toast.show({ message: t('chat.leaveToast', { name: `\u2068${name}\u2069` }) });
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('chat.leaveTitle')}
      footer={(
        <>
          <Button variant="destructive" className="me-auto" disabled={leave.isPending} onClick={() => leave.mutate({ conversationId: id })}>{t('chat.leaveConfirm')}</Button>
          <Button autoFocus onClick={onClose}>{t('common.cancel')}</Button>
        </>
      )}
    >
      <p dir="auto" className="pt-1 text-body text-ink">{t('chat.leaveBody')}</p>
    </Sheet>
  );
}

/** The open sheet of a group, or nothing. */
export function GroupSheets({ id, mode, onMode, name, people, me, makerId }: {
  id: string; mode: GroupMode | null; onMode: (mode: GroupMode | null) => void; name: string; people: UserCard[]; me: Me | undefined; makerId: string | null;
}) {
  const close = () => onMode(null);
  if (mode === 'people') return <PeopleSheet id={id} people={people} me={me} makerId={makerId} onMode={onMode} onClose={close} />;
  if (mode === 'rename') return <RenameSheet id={id} name={name} onClose={close} />;
  if (mode === 'add') return <AddSheet id={id} people={people} meId={me?.id} onClose={close} />;
  if (mode === 'leave') return <LeaveSheet id={id} name={name} onClose={close} />;
  return null;
}
