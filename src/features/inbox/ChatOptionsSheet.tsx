import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { NotifyLevel } from '../../api/contract/entities';
import type { UserCard } from '../../api/contract/views';
import { useRight } from '../../app/useRight';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../components/icons/animated/check';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { EllipsisIcon } from '../../components/icons/animated/ellipsis';
import { FolderKanbanIcon } from '../../components/icons/animated/folder-kanban';
import { PlusIcon } from '../../components/icons/animated/plus';
import { SquarePenIcon } from '../../components/icons/animated/square-pen';
import { Sheet } from '../../components/Sheet';
import { useNotifyItems } from './NotifyChoice';
import { PeopleRows, type PeopleMe } from './PeopleRows';

type GroupPart = {
  people: UserCard[]; me: PeopleMe | undefined; makerId: string | null; name: string;
  onMode: (mode: 'add' | 'rename' | 'leave') => void;
};

/** The row of the sheet: 56 px high, an ink word and an icon in ink (the rows of the message sheet). */
const ROW = 'pressable flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-start text-body hover:bg-fill focus:bg-fill focus:outline-none';

/** The "..." button of a chat header on a phone: 44 px, and it names its chat, so a screen reader does not hear the same name twice. */
export function OptionsButton({ title, onClick }: { title: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('chat.optionsFor', { title })}
      aria-haspopup="dialog"
      onClick={onClick}
      className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink"
    >
      <AnimatedIcon icon={EllipsisIcon} size={20} aria-hidden />
    </button>
  );
}

/**
 * One options sheet for every kind of chat on a phone (Direction D). It replaces the anchored menu: a new message or a resize cannot close
 * it. The order is the header (picture, name, line), the People part (a group), Add people and Rename (a group, with `chat.groupChange`),
 * the link row (Open the project, Open to-do), the Notify me choice (not for a to-do thread), Mark as unread (only when the chat was read),
 * Archive or Move back to Inbox, and Leave group (last). The Add, Rename and Leave sheets open in the next frame after this sheet closes:
 * a sheet inside a sheet fails in Vaul (the steps of the message sheet).
 */
export function ChatOptionsSheet({ open, onOpenChange, id, kind, title, lead, line, archived, unread, link, notify = 'all', group, onArchive, onMarkUnread }: {
  open: boolean; onOpenChange: (open: boolean) => void; id: string; kind: 'project' | 'direct' | 'group' | 'task'; title: string; lead: ReactNode; line: ReactNode;
  archived: boolean; unread: number; link?: { to: string; label: string }; notify?: NotifyLevel; group?: GroupPart;
  onArchive: (id: string, archived: boolean) => void; onMarkUnread: (id: string) => void;
}) {
  const { t } = useTranslation();
  const notifyItems = useNotifyItems(id, notify);
  // Add people and Rename need chat.groupChange (role rights version 2).
  const mayChange = useRight('chat.groupChange');
  const [next, setNext] = useState<'add' | 'rename' | 'leave' | null>(null);
  const pick = (mode: 'add' | 'rename' | 'leave') => {
    setNext(mode);
    onOpenChange(false);
  };
  useEffect(() => {
    if (open || next === null) return undefined;
    const frame = requestAnimationFrame(() => {
      group?.onMode(next);
      setNext(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, next]);
  const close = () => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('chat.optionsFor', { title })}
      phoneHeader={(
        <div className="flex min-w-0 items-center gap-3">
          {lead}
          <div className="min-w-0">
            <p className="text-section text-ink"><bdi className="block truncate">{title}</bdi></p>
            <p className="truncate text-footnote text-ink-2">{line}</p>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-1">
        {group && (
          <section aria-labelledby={`options-people-${id}`} className="pb-1">
            <h3 id={`options-people-${id}`} className="px-3 pb-1 text-footnote font-semibold text-ink-2">{t('chat.peopleTitle')}</h3>
            <PeopleRows id={id} people={group.people} me={group.me} makerId={group.makerId} rich onOpenChat={close} />
          </section>
        )}
        {group && mayChange && (
          <>
            <button type="button" className={`${ROW} text-ink`} onClick={() => pick('add')}>
              <AnimatedIcon icon={PlusIcon} size={20} className="text-ink" playWhen={open} aria-hidden />
              {t('chat.addPeople')}
            </button>
            <button type="button" className={`${ROW} text-ink`} onClick={() => pick('rename')}>
              <AnimatedIcon icon={SquarePenIcon} size={20} className="text-ink" playWhen={open} aria-hidden />
              {t('chat.rename')}
            </button>
          </>
        )}
        {link && (
          <Link to={link.to} onClick={close} className={`${ROW} text-ink`}>
            <AnimatedIcon icon={kind === 'task' ? ClipboardCheckIcon : FolderKanbanIcon} size={20} className="text-ink" playWhen={open} aria-hidden />
            {link.label}
          </Link>
        )}
        {kind !== 'task' && (
          <div role="radiogroup" aria-label={t('chat.notify')} className="flex flex-col">
            <p aria-hidden className="mx-3 mt-1 border-t border-hairline pb-1 pt-3 text-footnote font-semibold text-ink-2">{t('chat.notify')}</p>
            {notifyItems.map((item) => (
              <button
                key={item.label}
                type="button"
                role="radio"
                aria-checked={item.checked === true}
                onClick={item.onSelect}
                className={`${ROW} text-ink`}
              >
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.checked === true && <AnimatedIcon icon={CheckIcon} size={18} aria-hidden className="shrink-0 text-accent" />}
              </button>
            ))}
            <p className="px-3 pb-1.5 text-footnote text-ink-2">{t('chat.notifyNote')}</p>
          </div>
        )}
        {/* "Mark as unread" is for a chat that was read: a chat with new messages is unread already, and an archived chat is out of the list. */}
        {!archived && unread === 0 && (
          <button type="button" className={`${ROW} text-ink`} onClick={() => { close(); onMarkUnread(id); }}>{t('chat.markUnread')}</button>
        )}
        <button type="button" className={`${ROW} text-ink`} onClick={() => { close(); onArchive(id, !archived); }}>
          {archived ? t('chat.moveBack') : t('chat.archive')}
        </button>
        {group && (
          <button type="button" className={`${ROW} text-late`} onClick={() => pick('leave')}>{t('chat.leaveGroup')}</button>
        )}
      </div>
    </Sheet>
  );
}
