import { useMemo } from 'react';
import { useLang } from '../../app/lang';
import { SelectField } from '../../components/Fields';
import { clockFormat } from '../../lib/dates';
import { TIME_SLOTS } from './formModel';

/** The word of a time of the day in the screen language: "14:00", or "2:00 م" in Arabic. Office time has no daylight saving. */
function clockWord(time: string, lang: 'en' | 'ar'): string {
  return clockFormat(lang).format(new Date(`2026-01-01T${time}:00+03:00`));
}

/**
 * The time of a meeting (fbk_022): a select of 15-minute steps from 06:00 to 22:00. A value outside the steps (a meeting that an agent
 * planned at 10:05) stays a choice while it is the value, so a person never loses it by opening the form. The value is HH:MM.
 */
export function TimeField({ id, label, value, onChange, required, disabled, error }: {
  id: string; label: string; value: string; onChange: (time: string) => void; required?: boolean; disabled?: boolean; error?: string;
}) {
  const lang = useLang();
  const times = useMemo(() => (value && !TIME_SLOTS.includes(value) ? [...TIME_SLOTS, value].sort() : [...TIME_SLOTS]), [value]);
  return (
    <SelectField id={id} label={label} required={required} disabled={disabled} error={error} value={value} onChange={(event) => onChange(event.target.value)}>
      {times.map((time) => <option key={time} value={time}>{clockWord(time, lang)}</option>)}
    </SelectField>
  );
}
