import { useEffect, useRef, useState } from 'react';
import { useLang } from '../app/lang';
import { isFinePointer } from '../lib/calendar';
import { CalendarPopover } from './CalendarPopover';
import { ClearDate, DATE_BOX, DateFace, dateInputClass, quietDay } from './DateField';

type Props = {
  id: string;
  label: string;
  value: string;
  onCommit: (value: string | null) => void;
  error?: string;
  hint?: string;
  className?: string;
  disabled?: boolean;
  /** The label is for screen readers only, because a column name above the field says it (the stage dates). */
  hideLabel?: boolean;
  /** The first and the last day that the calendar offers (a stage end after its start). A day outside is greyed out. */
  min?: string;
  max?: string;
};

/** A full date in a year from 2000. While a person types a year, the browser reports years like 0002. */
const savable = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0, 4)) >= 2000;

/**
 * A date that saves itself (owner, 2026-10-05, item 8). It looks like a quiet button: "Set date…" when empty, else the short date
 * and a small clear control. A press opens the date picker of the browser, and the picked date saves at once. Where the browser
 * has no picker (or a page of another site holds Madar in a frame), and when the keyboard comes to it, the full date field shows,
 * and a typed date saves when the person leaves the field or presses Enter, not on every key.
 *
 * The real date field always sits on top of the quiet look, without colour. So a tap on a phone opens the phone's own picker,
 * and a screen reader hears a date field with its label and value.
 *
 * A date in a form that saves with its own button is `DateField`. Both take the quiet look from `DateField.tsx`.
 */
export function DateDraftField({ id, label, error, hint, className = '', value, onCommit, disabled, hideLabel = false, min, max }: Props) {
  const lang = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  // True while the person types the date in the full field.
  const [typing, setTyping] = useState(false);
  // A pointer press comes before the focus it gives. A focus with no press came from the keyboard.
  const pressed = useRef(false);
  // The box of the field. Madar's calendar opens under it on a computer (fbk_009).
  const box = useRef<HTMLDivElement>(null);
  // The box that the open calendar sits under, or null while no calendar is open.
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(null);
  // The draft sent last. Enter and the blur after it send the same draft once, so a reason sheet does not open twice (audit 2026-10-03, BRW-3).
  // A new visit to the field or a new draft forgets it, so a person can send a refused date again (review 2026-10-03).
  const sent = useRef<string | null>(null);
  useEffect(() => {
    setDraft(value);
    sent.current = null;
  }, [value]);

  const commit = (next: string) => {
    if (next === value || next === sent.current) return;
    if (next === '') {
      sent.current = next;
      onCommit(null);
      return;
    }
    if (!savable(next)) {
      setDraft(value);
      return;
    }
    sent.current = next;
    onCommit(next);
  };

  // The picker reports its choice with a change event, and the date saves at once. React's onChange also runs while a person types
  // a date, so it never saves.
  const latest = useRef({ typing, commit });
  latest.current = { typing, commit };
  useEffect(() => {
    const field = input.current;
    if (!field) return undefined;
    const onPick = () => {
      if (!latest.current.typing) latest.current.commit(field.value);
    };
    field.addEventListener('change', onPick);
    return () => field.removeEventListener('change', onPick);
  }, []);

  const openPicker = () => {
    const field = input.current;
    if (!field || typing || disabled) return;
    // A computer shows Madar's calendar (fbk_009). A phone keeps the picker of the phone.
    if (isFinePointer()) {
      setCalendarAnchor(box.current);
      return;
    }
    try {
      if (typeof field.showPicker !== 'function') throw new Error('No date picker in this browser.');
      field.showPicker();
    } catch {
      // No picker here: the person types the date.
      setTyping(true);
    }
  };

  // The focus returns to the field first. The focus clears the sent draft, so the save below sets it again, and the blur sends nothing.
  const backToField = () => {
    pressed.current = true;
    input.current?.focus();
    pressed.current = false;
  };
  const pickDay = (day: string) => {
    setCalendarAnchor(null);
    backToField();
    setDraft(day);
    commit(day);
  };
  const closeCalendar = () => {
    setCalendarAnchor(null);
    backToField();
  };

  const shown = savable(draft) ? quietDay(draft, lang) : '';
  const canClear = Boolean(draft) && !disabled;
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'field-label'}>{label}</label>
      <div ref={box} className={DATE_BOX}>
        <input
          ref={input}
          id={id}
          type="date"
          value={draft}
          min={min}
          max={max}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className={dateInputClass(typing)}
          onPointerDown={() => {
            pressed.current = true;
          }}
          onFocus={() => {
            sent.current = null;
            // A focus that comes back while Madar's calendar is open is no typing (UX audit 2026-10-19, chats-02).
            if (!pressed.current && !calendarAnchor) setTyping(true);
            pressed.current = false;
          }}
          onClick={() => {
            pressed.current = false;
            openPicker();
          }}
          onChange={(event) => {
            // A typed draft is new, so it may go again. A picked date was sent just before, by the change listener above.
            if (typing) sent.current = null;
            setDraft(event.target.value);
          }}
          onBlur={() => {
            commit(draft);
            setTyping(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(draft);
              return;
            }
            // A key typed after a press: the person types, so the full field shows.
            if (!typing && !['Tab', 'Shift', 'Escape'].includes(event.key)) setTyping(true);
          }}
        />
        {!typing && <DateFace shown={shown} roomForClear={canClear} invalid={Boolean(error)} />}
        {!typing && canClear && (
          <ClearDate
            label={label}
            onClear={() => {
              setDraft('');
              commit('');
            }}
          />
        )}
      </div>
      {calendarAnchor && <CalendarPopover anchor={calendarAnchor} value={draft} min={min} max={max} onPick={pickDay} onClose={closeCalendar} />}
      {hint && <p id={`${id}-hint`} className="text-caption text-ink-2">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-footnote text-late">{error}</p>}
    </div>
  );
}
