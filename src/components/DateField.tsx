import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../app/lang';
import { isFinePointer } from '../lib/calendar';
import { formatDay, todayISO, type Lang } from '../lib/dates';
import { CalendarPopover } from './CalendarPopover';
import { FieldShell, describedBy } from './Fields';
import { AnimatedIcon } from './icons/AnimatedIcon';
import { XIcon } from './icons/animated/x';

/** The short date of a quiet date: "12 Oct", with the year only for a date in another year. Not a full date: no text. */
export function quietDay(day: string, lang: Lang): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  return formatDay(day, lang, day.slice(0, 4) === todayISO().slice(0, 4) ? 'short' : 'shortYear');
}

/**
 * The box of a date: the quiet look with the real date field on top. At most 12rem wide, so in a wide column the clear control
 * stays near its date and does not float at the far end.
 */
export const DATE_BOX = 'relative min-h-11 max-w-48';

/** The real date field: on top of the quiet look without colour, or the full field while a person types a date. */
export function dateInputClass(typing: boolean): string {
  return typing ? 'field min-h-11' : 'peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-default';
}

/**
 * The quiet look under the real date field: the short date, or "Set date…" in the quiet grey. It takes the hover fill and the focus
 * ring of the date field above it. An invalid date gets a red edge, as every invalid field does.
 *
 * It has the box of a field without the fill: the same height, corners, 1 px edge and 14 px side space. So its text lines up with
 * the text of the fields above and below it (owner, 2026-10-05: "and the alignment").
 */
export function DateFace({ shown, roomForClear, invalid, empty, align = 'start' }: { shown: string; roomForClear: boolean; invalid?: boolean; empty?: string; align?: 'start' | 'end' }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden
      className={`pointer-events-none flex min-h-11 items-center rounded-xl border ps-3.5 text-subheadline ${align === 'end' ? 'justify-end' : ''} peer-hover:bg-fill peer-focus-visible:outline-2 peer-focus-visible:outline-link ${roomForClear ? 'pe-10' : 'pe-3.5'} ${invalid ? 'border-late' : 'border-transparent'}`}
    >
      {shown ? <span className="tabular truncate text-ink">{shown}</span>
        : empty !== undefined ? <span className="truncate font-semibold text-link">{empty}</span> : <span className="truncate text-ink-2">{t('dateField.set')}</span>}
    </span>
  );
}

/** The small control at the end of a set date that empties it. */
export function ClearDate({ label, onClear, touch = false }: { label: string; onClear: () => void; touch?: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('dateField.clear', { label })}
      onClick={onClear}
      // A quiet grey that still holds 3:1 (WCAG 1.4.11), so a column of set dates does not read as a column of buttons.
      className={`pressable absolute end-1 top-1/2 z-20 grid -translate-y-1/2 place-items-center rounded-full text-chart-muted hover:bg-fill hover:text-ink ${touch ? 'size-11' : 'size-8'}`}
    >
      <AnimatedIcon icon={XIcon} size={14} aria-hidden />
    </button>
  );
}

type DateFieldProps = {
  id: string;
  label: string;
  /** The date as YYYY-MM-DD, or '' for no date. */
  value: string;
  /** Each change goes to the form at once. The form saves with its own button. */
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
  /** The small clear control. By default only a date that is not required has it: a required date changes, it never goes empty. */
  clearable?: boolean;
  /** A message elsewhere on the form marks the field and describes it (the plan line of a template). */
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** `end` puts the short date at the end of the field (a grouped row of the phone panel). Default `start`. */
  align?: 'start' | 'end';
  /** Makes the clear control a 44 px target. Default false. */
  touchClear?: boolean;
};

/**
 * A date in a form that saves with its own button (owner, 2026-10-05): the same quiet look as the dates that save themselves
 * (`DateDraftField`). Empty: "Set date…" in the quiet grey. Set: the short date and a small clear control. A press opens the date
 * picker of the browser. Where the browser has no picker, and when the keyboard comes to it, the full date field shows to type in.
 *
 * The real date field always sits on top of the quiet look, without colour. So a tap on a phone opens the phone's own picker, a
 * screen reader hears a date field with its label and value, and the label, the asterisk, the hint and the error are the same as in
 * every other field (`FieldShell`).
 */
export function DateField({
  id, label, value, onChange, onBlur, error, hint, required, disabled, min, max, className, clearable = !required,
  'aria-invalid': markedInvalid, 'aria-describedby': describedElsewhere, align, touchClear,
}: DateFieldProps) {
  const lang = useLang();
  const input = useRef<HTMLInputElement>(null);
  // True while the person types the date in the full field.
  const [typing, setTyping] = useState(false);
  // A pointer press comes before the focus it gives. A focus with no press came from the keyboard (or from the form, to an error).
  const pressed = useRef(false);
  // The box of the field. Madar's calendar opens under it on a computer (fbk_009).
  const box = useRef<HTMLDivElement>(null);
  // The box that the open calendar sits under, or null while no calendar is open.
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(null);

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
      // No picker here (or a page of another site holds Madar in a frame): the person types the date.
      setTyping(true);
    }
  };

  // The focus returns to the field. The press flag keeps the full field hidden (a press comes before its focus).
  const backToField = () => {
    pressed.current = true;
    input.current?.focus();
    pressed.current = false;
  };
  const pickDay = (day: string) => {
    setCalendarAnchor(null);
    backToField();
    onChange(day);
  };
  const closeCalendar = () => {
    setCalendarAnchor(null);
    backToField();
  };

  const invalid = markedInvalid ?? (error ? true : undefined);
  const canClear = clearable && value !== '' && !disabled;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <div ref={box} className={DATE_BOX}>
        <input
          ref={input}
          id={id}
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedElsewhere ?? describedBy(id, hint, error, required)}
          className={dateInputClass(typing)}
          onPointerDown={() => {
            pressed.current = true;
          }}
          onFocus={() => {
            // A focus that comes back while Madar's calendar is open is no typing (UX audit 2026-10-19, chats-02).
            if (!pressed.current && !calendarAnchor) setTyping(true);
            pressed.current = false;
          }}
          onClick={() => {
            pressed.current = false;
            openPicker();
          }}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setTyping(false);
            onBlur?.();
          }}
          onKeyDown={(event) => {
            // A key typed after a press: the person types, so the full field shows. Enter still sends the form.
            if (!typing && !['Tab', 'Shift', 'Escape', 'Enter'].includes(event.key)) setTyping(true);
          }}
        />
        {!typing && <DateFace shown={quietDay(value, lang)} roomForClear={canClear} invalid={Boolean(invalid)} align={align} />}
        {!typing && canClear && <ClearDate label={label} onClear={() => onChange('')} touch={touchClear} />}
      </div>
      {calendarAnchor && (
        <CalendarPopover anchor={calendarAnchor} value={value} min={min} max={max} onPick={pickDay} onClose={closeCalendar} />
      )}
    </FieldShell>
  );
}
