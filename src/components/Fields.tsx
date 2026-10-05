import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

/** "required" shows an asterisk after the label and gives screen readers a hidden "required" word (owner, 2026-10-05, item 1). */
type FieldProps = { id: string; label: string; error?: string; hint?: string; className?: string; required?: boolean };

const CONTROL = 'field';

function describedBy(id: string, hint?: string, error?: string, required?: boolean): string | undefined {
  return [required ? `${id}-required` : '', hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

/**
 * The label that a required field marks with an asterisk. The asterisk sits outside the label, so the name of the field stays
 * the label text. The hidden word is part of the description. The browser never checks the field: the form shows its messages.
 */
function FieldLabel({ id, label, required }: { id: string; label: string; required?: boolean }) {
  const { t } = useTranslation();
  if (!required) return <label htmlFor={id} className="field-label">{label}</label>;
  return (
    <div className="flex items-baseline gap-0.5">
      <label htmlFor={id} className="field-label">{label}</label>
      <span aria-hidden="true" className="field-label">*</span>
      <span id={`${id}-required`} className="sr-only">{t('fields.required')}</span>
    </div>
  );
}

/** The label above, then the hint and the inline error below (spec 11.6). */
function Shell({ id, label, error, hint, className = '', required, children }: FieldProps & { children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <FieldLabel id={id} label={label} required={required} />
      {children}
      {hint && <p id={`${id}-hint`} className="text-caption text-ink-2">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-footnote text-late">{error}</p>}
    </div>
  );
}

export function TextField({ id, label, error, hint, className, required, ...input }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, required)} {...input} className={`min-h-11 ${CONTROL}`} />
    </Shell>
  );
}

export function TextArea({ id, label, error, hint, className, required, ...input }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, required)} {...input} className={`min-h-24 ${CONTROL}`} />
    </Shell>
  );
}

export function SelectField({ id, label, error, hint, className, required, children, ...input }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, required)} {...input} className={`min-h-11 ${CONTROL}`}>
        {children}
      </select>
    </Shell>
  );
}

/**
 * A date field that saves when the person leaves it or presses Enter, not on every key.
 * While a person types a year, the browser reports years like 0002; a year before 2000 never saves.
 */
export function DateDraftField({ id, label, error, hint, className, value, onCommit, disabled }: FieldProps & {
  value: string; onCommit: (value: string | null) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // The draft sent last. Enter and the blur after it send the same draft once, so a reason sheet does not open twice (audit 2026-10-03, BRW-3).
  // A new visit to the field or a new draft forgets it, so a person can send a refused date again (review 2026-10-03).
  const sent = useRef<string | null>(null);
  useEffect(() => {
    setDraft(value);
    sent.current = null;
  }, [value]);
  const commit = () => {
    if (draft === value || draft === sent.current) return;
    if (draft === '') {
      sent.current = draft;
      onCommit(null);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft) || Number(draft.slice(0, 4)) < 2000) {
      setDraft(value);
      return;
    }
    sent.current = draft;
    onCommit(draft);
  };
  return (
    <TextField
      id={id}
      label={label}
      error={error}
      hint={hint}
      className={className}
      type="date"
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        sent.current = null;
        setDraft(event.target.value);
      }}
      onFocus={() => { sent.current = null; }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    />
  );
}
