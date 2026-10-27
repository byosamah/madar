/**
 * One choice of a filter group: a radio with its word, in a row for a finger (44 px). The groups of the Tasks, Activity and Tracker tabs
 * use it. `value` is for a group that needs the attribute on the input; the others leave it out.
 */
/** The row of a filter choice, for a finger (44 px). The Show done checkbox of the Tasks tab uses it too. */
export const CHOICE_ROW = 'flex min-h-11 items-center gap-3 text-body text-ink';

export function RadioChoice({ name, value, checked, label, onChange }: { name: string; value?: string; checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className={CHOICE_ROW}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-5 accent-[var(--sig-from)]" />
      {label}
    </label>
  );
}
