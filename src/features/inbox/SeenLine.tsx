import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../../api/contract/views';
import { usePersonName } from '../../app/personName';
import { PersonFace } from '../../components/PersonFace';
import { Popover } from '../../components/Popover';

/**
 * What the log needs for the Seen line (chat presence design C). `readers` are the other members who have a seen time, `others` is the
 * count of the other members of today. `people` gives the cards for the names list. `context` is the gender context of the other person
 * of a direct chat, for the Arabic verb.
 */
export type SeenInfo = {
  kind: 'direct' | 'group' | 'project';
  readers: { userId: string; at: string }[];
  others: number;
  people?: UserCard[];
  context?: 'female';
};

/** The names of the readers, with the face and the dot and with no times (design C2). */
function Readers({ readers, people, anchor, onClose }: { readers: SeenInfo['readers']; people: UserCard[]; anchor: HTMLElement; onClose: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const cards = [...readers]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .flatMap((reader) => people.find((person) => person.id === reader.userId) ?? []);
  return (
    <Popover anchor={anchor} label={t('chat.seenByTitle')} onClose={onClose} fit>
      <p className="shrink-0 text-footnote font-semibold text-ink-2">{t('chat.seenByTitle')}</p>
      <ul className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {cards.map((person) => (
          <li key={person.id} className="flex min-h-11 items-center gap-3 px-2">
            <PersonFace user={person} size={24} />
            <bdi className="truncate text-subheadline text-ink">{nameOf(person)}</bdi>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

/**
 * The line under the last own message of a chat (chat presence design C1 and C2). `since` is the time of that message: a reader counts
 * when the seen time of the reader is at or after it. A direct chat says "Seen". A group or a project says "Seen by N" or "Seen by
 * everyone", and nothing at 0. In a group or a project the line is a button that opens the names.
 */
export function SeenLine({ info, since }: { info: SeenInfo; since: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const after = Date.parse(since);
  const readers = info.readers.filter((reader) => Date.parse(reader.at) >= after);
  const count = readers.length;
  if (count === 0) return null;
  const line = 'self-end px-1 text-caption text-ink-2';
  if (info.kind === 'direct') return <li className={line}>{t('chat.seen', { context: info.context })}</li>;
  const text = info.others > 0 && count >= info.others ? t('chat.seenByAll') : t('chat.seenBy', { count });
  return (
    <li className={line}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="pressable min-h-11 rounded-full px-2 text-caption text-link hover:bg-fill"
      >
        {text}
      </button>
      {open && button.current && <Readers readers={readers} people={info.people ?? []} anchor={button.current} onClose={() => setOpen(false)} />}
    </li>
  );
}
