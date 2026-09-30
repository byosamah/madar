export function Switch({
  id, label, description, checked, onChange,
}: { id: string; label: string; description?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-body">{label}</label>
        {description && <p id={`${id}-hint`} className="text-footnote text-label-2">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-hint` : undefined}
        onClick={() => onChange(!checked)}
        className={`pressable relative h-[31px] w-[51px] shrink-0 rounded-full ${checked ? 'bg-green' : 'bg-fill-strong'}`}
      >
        <span
          aria-hidden
          className={`absolute start-[2px] top-[2px] size-[27px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5 rtl:-translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}
