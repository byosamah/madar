import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { usePersonName } from '../app/personName';
import { matchesPerson } from '../lib/personName';
import { activeMention } from '../lib/text';
import { Avatar } from './Avatar';

/** A text box with an @mention picker (spec 5.2 and 7.2). The arrow keys move through the names, Enter picks one, Escape closes the list. */
export function MentionField({
  id, label, value, onChange, people, onPick, placeholder, rows = 3, inputRef, className = '',
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
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const mention = activeMention(value, caret);
  // Both names match (owner item 12). The list and the inserted text use the name of the screen language.
  const matches = mention ? people.filter((person) => matchesPerson(person, mention.query)).slice(0, 5) : [];
  const open = matches.length > 0 && dismissedAt !== mention?.start;
  const listId = `${id}-mentions`;

  const pick = (person: UserCard) => {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const insert = `@${nameOf(person)} `;
    const position = before.length + insert.length;
    const next = before + insert + value.slice(caret);
    onChange(next);
    setCaret(position);
    setActive(0);
    // The picked name still matches its own text, so the list stays closed for this mention until the person types again.
    setDismissedAt(mention.start);
    onPick?.(person);
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
      setActive((i) => (i + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(matches[active] ?? matches[0]);
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
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
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
        <ul id={listId} role="listbox" aria-label={t('overview.mentionList')} className="float absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-2xl p-1.5">
          {matches.map((person, i) => (
            <li
              key={person.id}
              id={`${listId}-${person.id}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 ${i === active ? 'bg-fill' : ''}`}
            >
              <span aria-hidden><Avatar user={person} size={24} /></span>
              <bdi>{nameOf(person)}</bdi>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
