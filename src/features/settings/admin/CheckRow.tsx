import type { ReactNode } from 'react';

/**
 * A tick box with its label in one pressable row (the template editor and the sheet that adds stages). With an `id`, the label points at
 * the box. `className` adds classes to the row.
 */
export function CheckRow({ id, checked, onChange, className, children }: {
  id?: string; checked: boolean; onChange: (checked: boolean) => void; className?: string; children: ReactNode;
}) {
  return (
    <label htmlFor={id} className={`${className ? `${className} ` : ''}flex min-h-11 items-center gap-3 self-start rounded-xl pe-2 hover:bg-fill`}>
      <input
        id={id}
        type="checkbox"
        className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
  );
}
