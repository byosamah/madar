import { useId, type ReactNode } from 'react';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../../components/icons/animated/chevron-down';
import { DateDraftField } from '../../../components/DateDraftField';
import { Switch } from '../../../components/Switch';

/**
 * The rows of the task panel on a phone (Direction D). A Group is a titled box of rows: the title is small and quiet, the body is a grey
 * rounded box, and the rows inside it are divided by the hairline (`.hairline` in tokens.css draws a line between direct children).
 * A row is at least 48 px high. The label sits at the start and the value at the end, with logical classes only.
 */
export function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="px-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h3>
      <div className="hairline rounded-2xl bg-fill">{children}</div>
      {hint && <p className="px-1 text-caption text-ink-2">{hint}</p>}
    </section>
  );
}

/** A label and a value as plain text, for a field the viewer cannot change. It is no button and has no chevron (no dead control). */
export function ValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-1.5">
      <span className="shrink-0 text-body">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-end text-body text-ink-2">{children}</span>
    </div>
  );
}

/**
 * A row that opens the picker of the phone. The real `<select>` lies over the row, transparent and at full size, so a tap on the row opens
 * the native picker, a screen reader hears a select with the label, and the id stays for the browser specs. No new picker exists.
 */
export function PickRow({ id, label, value, display, onChange, children }: {
  id: string; label: string; value: string; display: ReactNode; onChange: (value: string) => void; children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-12 items-center justify-between gap-3 px-4 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-link">
      <span aria-hidden className="shrink-0 text-body">{label}</span>
      <span aria-hidden className="flex min-w-0 items-center justify-end gap-2 text-end text-body text-ink-2">
        {display}
        <AnimatedIcon icon={ChevronDownIcon} size={16} className="shrink-0 text-label-3" aria-hidden />
      </span>
      <select
        id={id}
        data-row-control
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {children}
      </select>
    </div>
  );
}

/**
 * The switch of the desk in a row. Its word covers the whole row (the label draws an overlay), and the button stays above the overlay, so a
 * tap anywhere on the row reaches the same switch. The ids and `role="switch"` of the desk stay.
 */
export function SwitchRow({ id, label, description, checked, onChange }: {
  id: string; label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return (
    <div
      data-switch-row
      className="relative min-h-12 px-4 py-0.5 [&_button]:relative [&_button]:z-10 [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:content-['']"
    >
      <Switch id={id} label={label} description={description} checked={checked} onChange={onChange} />
    </div>
  );
}

/**
 * A date that saves itself, in a row: the label sits at the start, and the quiet date with its clear control (a 44 px target) sits at the end.
 * It is the `DateDraftField` of the desk, so the picker of the phone, the reason sheet and the clear control all stay.
 */
export function DateRow({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (value: string | null) => void }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 ps-4 pe-1">
      <span aria-hidden className="min-w-0 flex-1 text-body">{label}</span>
      <div className="w-44 max-w-[60%] shrink-0">
        <DateDraftField id={id} label={label} value={value} onCommit={onCommit} hideLabel align="end" touchClear />
      </div>
    </div>
  );
}
