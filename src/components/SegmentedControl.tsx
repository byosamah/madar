import { useRef, type KeyboardEvent } from 'react';

/**
 * A radio group as one row of buttons. The group is one Tab stop; the arrow keys move the choice, the end-side arrow
 * forward, the same way the tabs do (audit 2026-10-03, SHL-18).
 */
export function SegmentedControl<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const back = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (!forward && !back) return;
    event.preventDefault();
    const index = (Math.max(selected, 0) + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[index].value);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex flex-wrap self-start rounded-full bg-fill p-0.5">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === (selected < 0 ? 0 : selected) ? 0 : -1}
          onClick={() => onChange(option.value)}
          className={`pressable min-h-11 rounded-full px-4 text-subheadline font-medium ${option.value === value ? 'bg-card text-ink shadow-card' : 'text-ink-2 transition-colors hover:text-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
