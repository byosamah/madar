import type { KeyboardEvent, ReactNode } from 'react';

/** Tabs for the sections of one screen. The arrow keys move the selection, the end-side arrow forward. */
export function Tabs<T extends string>({
  label, value, options, onChange, idPrefix = 'tab',
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; idPrefix?: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const step = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-${next.value}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`pressable min-h-11 shrink-0 rounded-full px-4 text-subheadline font-semibold ${selected ? 'bg-label text-bg' : 'text-label-2 hover:bg-fill'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, idPrefix = 'tab', children }: { value: string; idPrefix?: string; children: ReactNode }) {
  return (
    <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-${value}`}>
      {children}
    </div>
  );
}
