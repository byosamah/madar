import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type FieldProps = { id: string; label: string; error?: string; hint?: string; className?: string };

const CONTROL = 'field';

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

/** The label above, then the hint and the inline error below (spec 11.6). */
function Shell({ id, label, error, hint, className = '', children }: FieldProps & { children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-caption text-ink-2">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-footnote text-late">{error}</p>}
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
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-24 ${CONTROL}`} />
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
