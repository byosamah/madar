export function SegmentedControl<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-full bg-fill p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`pressable min-h-11 rounded-full px-4 text-subheadline font-medium ${option.value === value ? 'bg-card text-label shadow-card' : 'text-label-2'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
