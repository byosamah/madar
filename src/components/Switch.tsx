/**
 * The round button of a switch, with no label and no box around it. A row that sets its own height uses it (the Me hub). The button stays 51 by
 * 31 px. An invisible ::after area adds 7 px above and below, so the press area is 51 by 45 px (the 44 px target rule).
 */
export function SwitchButton({
  id, checked, onChange, describedBy,
}: { id: string; checked: boolean; onChange: (next: boolean) => void; describedBy?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className={`pressable relative h-[31px] w-[51px] shrink-0 rounded-full after:absolute after:-inset-y-[7px] after:inset-x-0 after:content-[''] ${checked ? 'bg-green' : 'bg-fill-strong'}`}
    >
      <span
        aria-hidden
        className={`absolute start-[2px] top-[2px] size-[27px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5 rtl:-translate-x-5' : ''}`}
      />
    </button>
  );
}

export function Switch({
  id, label, description, checked, onChange,
}: { id: string; label: string; description?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-body">{label}</label>
        {description && <p id={`${id}-hint`} className="text-footnote text-label-2">{description}</p>}
      </div>
      <SwitchButton id={id} checked={checked} onChange={onChange} describedBy={description ? `${id}-hint` : undefined} />
    </div>
  );
}

/** A small switch with its word at the start, for one choice inside a line of other words, such as beside a legend. */
export function SmallSwitch({
  id, label, checked, onChange,
}: { id: string; label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2">
      <label htmlFor={id} className="text-footnote text-ink-2">{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`pressable relative h-6 w-10 shrink-0 rounded-full ${checked ? 'bg-green' : 'bg-fill-strong'}`}
      >
        <span
          aria-hidden
          className={`absolute start-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4 rtl:-translate-x-4' : ''}`}
        />
      </button>
    </span>
  );
}
