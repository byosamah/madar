import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { usePersonName } from '../app/personName';
import { rankedMatches } from '../lib/personName';
import { activeMention } from '../lib/text';
import { PersonFace } from './PersonFace';

/** The three words that name everyone (src/lib/text.ts, mentionsEveryone), in lower case, for the letters typed after the "@". */
const EVERYONE_WORDS = ['everyone', 'all', 'الجميع'];

type Row = { kind: 'everyone' } | { kind: 'person'; person: UserCard };

/**
 * A text box with an @mention picker (spec 5.2 and 7.2). The arrow keys move through the names, Enter picks one, Escape closes the list.
 * The names that start with the typed letters come first (UX audit 2026-10-19, chats-01). A box at the bottom of a panel opens the
 * list above itself (`placement="above"`), so the panel does not cut it.
 *
 * `everyone` (owner, 2026-10-22, fbk_041) is the count of people that @everyone names here: the list then starts with the row "Everyone ·
 * N people" when nothing is typed after the "@" or the letters fit "everyone", "all" or "الجميع". A pick puts @everyone (English
 * screens) or @الجميع (Arabic screens) into the box. The caller gives no count where the words name nobody (a direct chat, no right).
 */
export function MentionField({
  id, label, value, onChange, people, onPick, placeholder, rows = 3, inputRef, className = '', placement = 'below', everyone, listMaxHeight,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  people: UserCard[];
  onPick?: (person: UserCard) => void;
  placeholder?: string;
  rows?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
  placement?: 'below' | 'above';
  everyone?: number;
  /** A CSS length for the list. The list then scrolls inside it. The chat box of a phone uses it, so the list stops under the header. */
  listMaxHeight?: string;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = usePersonName();
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const mention = activeMention(value, caret);
  // Both names match (owner item 12). The list and the inserted text use the name of the screen language.
  const matches = mention ? rankedMatches(people, mention.query).slice(0, 5) : [];
  // The row "Everyone" comes first when the typed letters are the start of one of the three words (or nothing is typed yet).
  const typed = mention?.query.trim().toLowerCase() ?? '';
  const everyoneRow = everyone !== undefined && everyone > 0 && mention !== null && EVERYONE_WORDS.some((word) => word.startsWith(typed));
  const entries: Row[] = [...(everyoneRow ? [{ kind: 'everyone' as const }] : []), ...matches.map((person) => ({ kind: 'person' as const, person }))];
  const open = entries.length > 0 && dismissedAt !== mention?.start;
  const listId = `${id}-mentions`;
  const rowId = (row: Row) => (row.kind === 'everyone' ? `${listId}-everyone` : `${listId}-${row.person.id}`);

  const pick = (row: Row) => {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const insert = `${row.kind === 'everyone' ? t('mentionEveryone.word') : `@${nameOf(row.person)}`} `;
    const position = before.length + insert.length;
    const next = before + insert + value.slice(caret);
    onChange(next);
    setCaret(position);
    setActive(0);
    // The picked name still matches its own text, so the list stays closed for this mention until the person types again.
    setDismissedAt(mention.start);
    if (row.kind === 'person') onPick?.(row.person);
    requestAnimationFrame(() => {
      ref.current?.focus();
      // A letter typed before this frame already stands after the name: the caret stays where the typing left it, so the
      // next letters do not land before it (whole-product check after wave 4).
      if (ref.current?.value === next) ref.current.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % entries.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + entries.length) % entries.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(entries[active] ?? entries[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(mention?.start ?? null);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        dir="auto"
        rows={rows}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && entries[active] ? rowId(entries[active]) : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setDismissedAt(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="field resize-y"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('overview.mentionList')}
          style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined}
          className={`float absolute end-0 z-30 flex w-[max(100%,min(18rem,calc(100vw_-_2rem)))] flex-col rounded-2xl p-1.5 ${listMaxHeight ? 'overflow-y-auto' : ''} ${placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          {entries.map((row, i) => (
            <li
              key={rowId(row)}
              id={rowId(row)}
              role="option"
              aria-selected={i === active}
              onPointerDown={(event) => {
                event.preventDefault();
                pick(row);
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 ${i === active ? 'bg-fill' : ''}`}
            >
              {row.kind === 'everyone' ? (
                <span className="font-semibold">{t('mentionEveryone.row', { count: everyone })}</span>
              ) : (
                <>
                  <span aria-hidden><PersonFace user={row.person} size={24} /></span>
                  <bdi>{nameOf(row.person)}</bdi>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
