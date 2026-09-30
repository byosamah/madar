import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

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
