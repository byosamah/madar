import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

/** "required" shows an asterisk after the label and gives screen readers a hidden "required" word (owner, 2026-10-05, item 1). */
type FieldProps = { id: string; label: string; error?: string; hint?: string; className?: string; required?: boolean };

const CONTROL = 'field';

/** The ids that describe a field: the hidden "required" word, the hint, the error. */
export function describedBy(id: string, hint?: string, error?: string, required?: boolean): string | undefined {
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

/** The label above, then the hint and the inline error below (spec 11.6). The date field (`DateField.tsx`) uses it too. */
export function FieldShell({ id, label, error, hint, className = '', required, children }: FieldProps & { children: ReactNode }) {
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
    <FieldShell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, required)} {...input} className={`min-h-11 ${CONTROL}`} />
    </FieldShell>
  );
}

export function TextArea({ id, label, error, hint, className, required, ...input }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, required)} {...input} className={`min-h-24 ${CONTROL}`} />
    </FieldShell>
  );
}

export function SelectField({ id, label, error, hint, className, required, children, ...input }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={className} required={required}>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, required)} {...input} className={`min-h-11 ${CONTROL}`}>
        {children}
      </select>
    </FieldShell>
  );
}
