export type ChipOption<T extends string> = { value: T; label: string };

/** One choice from a row of chips (spec 4.3). On a phone the row scrolls sideways. */
export function ChipGroup<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: ChipOption<T>[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`pressable min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-subheadline font-medium ${selected ? 'bg-ink text-panel' : 'bg-fill text-ink'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
