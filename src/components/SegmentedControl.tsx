import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { spring } from '../design/motion';
import { arrowStep } from '../lib/keys';
import { Badge } from './Badge';

type Option<T extends string> = {
  value: T; label: string; icon?: ReactNode;
  /** A red count after the label, shown when it is above 0 (the two Inbox views). */
  count?: number;
  /** The words of the count for a screen reader. They join the name of the radio. */
  countLabel?: string;
};

/**
 * A radio group as one row of buttons. The group is one Tab stop; the arrow keys move the choice, the end-side arrow
 * forward, the same way the tabs do (audit 2026-10-03, SHL-18).
 * `fill` gives the full width, equal options and one thumb that slides to the chosen option (Direction D, the phone switches).
 */
export function SegmentedControl<T extends string>({
  label, value, options, onChange, fill = false, layoutId, onOptionPointerDown,
}: {
  label: string; value: T; options: Option<T>[]; onChange: (value: T) => void;
  fill?: boolean;
  /** With `fill`, the id of the sliding thumb. It falls back to a generated id. */
  layoutId?: string;
  /** Tells the screen that a pointer went down on an option, before the click ends. */
  onOptionPointerDown?: (value: T) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const generated = useId();
  const thumbId = layoutId ?? generated;
  const selected = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event.key, document.documentElement.dir === 'rtl', true);
    if (step === 0) return;
    event.preventDefault();
    const index = (Math.max(selected, 0) + step + options.length) % options.length;
    onChange(options[index].value);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={fill ? 'flex w-full rounded-full bg-fill p-0.5' : 'inline-flex flex-wrap self-start rounded-full bg-fill p-0.5'}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === (selected < 0 ? 0 : selected) ? 0 : -1}
            onPointerDown={onOptionPointerDown ? () => onOptionPointerDown(option.value) : undefined}
            onClick={() => onChange(option.value)}
            className={fill
              ? `pressable relative isolate inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-subheadline font-medium ${checked ? 'text-ink' : 'text-ink-2 transition-colors hover:text-ink'}`
              : `pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-subheadline font-medium ${checked ? 'bg-card text-ink shadow-card' : 'text-ink-2 transition-colors hover:text-ink'}`}
          >
            {fill && checked && (
              <motion.span data-thumb={thumbId} layoutId={thumbId} transition={spring.standard} className="absolute inset-0 -z-10 rounded-full bg-card shadow-card" />
            )}
            {/* A picture beside the word is decoration: the word names the choice. */}
            {option.icon && <span aria-hidden="true" className="inline-flex shrink-0">{option.icon}</span>}
            {option.label}
            {/* The space keeps the word and the count apart in the name of the radio. A flex row draws no space from it. */}
            {option.count !== undefined && option.count > 0 && <>{' '}<Badge count={option.count} label={option.countLabel ?? String(option.count)} /></>}
          </button>
        );
      })}
    </div>
  );
}
