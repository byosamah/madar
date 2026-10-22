import { motion } from 'motion/react';
import type { KeyboardEvent, ReactNode } from 'react';
import { spring } from '../design/motion';
import { arrowStep } from '../lib/keys';

/** Tabs for the sections of one screen. The arrow keys move the selection, the end-side arrow forward. */
export function Tabs<T extends string>({
  label, value, options, onChange, idPrefix = 'tab', onTabPointerDown,
}: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; idPrefix?: string;
  /** Tells the screen that a pointer went down on a tab, before the click ends. A screen may start the work of that tab (LV-10). */
  onTabPointerDown?: (value: T) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event.key, document.documentElement.dir === 'rtl');
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-${next.value}`)?.focus();
  };
  // The row scrolls sideways on a phone. A sideways scroll box also scrolls up and down, so the row clips that direction and hides
  // its scrollbar. The hairline is an inner shadow, so the underline of the open tab covers it inside the row (owner, 2026-10-05).
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mx-4 flex gap-1 overflow-x-auto overflow-y-hidden px-4 shadow-[inset_0_-1px_0_var(--c-hairline)] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
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
            onPointerDown={onTabPointerDown ? () => onTabPointerDown(option.value) : undefined}
            onClick={() => onChange(option.value)}
            className={`pressable relative min-h-11 shrink-0 px-3 text-subheadline font-semibold ${selected ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {option.label}
            {selected && <motion.span layoutId={`${idPrefix}-underline`} transition={spring.standard} className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink" />}
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
