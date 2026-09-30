import { useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type FieldProps = { id: string; label: string; error?: string; hint?: string; className?: string };

const CONTROL = 'w-full rounded-control bg-fill px-3 text-body text-label aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-red';

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

/** The label above, then the hint and the inline error below (spec 11.6). */
function Shell({ id, label, error, hint, className = '', children }: FieldProps & { children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-footnote text-label-2">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-caption text-label-2">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-footnote text-red-text">{error}</p>}
    </div>
  );
}

export function TextField({ id, label, error, hint, className, ...input }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className}>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-11 ${CONTROL}`} />
    </Shell>
  );
}

export function TextArea({ id, label, error, hint, className, ...input }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-24 py-2 ${CONTROL}`} />
    </Shell>
  );
}

export function SelectField({ id, label, error, hint, className, children, ...input }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className}>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-11 ${CONTROL}`}>
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
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    if (draft === '') {
      onCommit(null);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft) || Number(draft.slice(0, 4)) < 2000) {
      setDraft(value);
      return;
    }
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
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    />
  );
}
