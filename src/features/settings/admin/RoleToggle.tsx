/**
 * One small switch of the role sheet. It is one button with a 44 px press area: the optional word (a scope such as "My projects") sits
 * at its start, the track at its end. `state` is true, false, or 'mixed' (the All switch of a section where some switches are on).
 * The button carries the accessible name; the word is only for the eye. The track is plain: green when on, grey when off, grey with
 * the knob in the middle when mixed. No tinted pill (calm design rules).
 * `all` marks the All switch of a section. It is a checkbox (role="checkbox"), because ARIA allows aria-checked="mixed" on a checkbox and
 * not on a switch. It looks the same as the other switches (role rights version 2, screens track).
 */
export function RoleToggle({ id, name, word, state, describedBy, all = false, onChange }: {
  id: string; name: string; word?: string; state: boolean | 'mixed'; describedBy?: string; all?: boolean; onChange: (on: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role={all ? 'checkbox' : 'switch'}
      aria-checked={state}
      aria-label={name}
      aria-describedby={describedBy}
      onClick={() => onChange(state !== true)}
      className="pressable inline-flex min-h-11 min-w-11 items-center justify-end gap-2 rounded-xl px-1"
    >
      {word && <span aria-hidden className="text-footnote text-ink-2">{word}</span>}
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full ${state === true ? 'bg-green' : 'bg-fill-strong'}`}>
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            state === true ? 'start-0.5 translate-x-4 rtl:-translate-x-4' : state === 'mixed' ? 'start-0.5 translate-x-2 rtl:-translate-x-2' : 'start-0.5'
          }`}
        />
      </span>
    </button>
  );
}
