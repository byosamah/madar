import { useTranslation } from 'react-i18next';
import { SelectField } from '../../components/Fields';
import type { Lang } from '../../lib/dates';
import type { Clock, WorkRange } from '../../lib/quietHours';
import { WEEKDAYS, clockLabel, endOptions, startOptions, weekdayName } from './workRange';

/**
 * The days and the two times of a work range (quiet hours, fbk_048): seven small day toggles from Sunday, then "From" and "To" with the
 * 30-minute steps. The Settings section and the Admin block both use it. With a `lock` (the office keeps notifications on), the days of
 * the lock stay ticked and locked, and the times stay outside the lock, so the range always holds it. The last day cannot be turned off.
 */
export type RangeLock = { on: boolean; days: readonly number[]; from: Clock; to: Clock };

export function WorkRangeFields({ idPrefix, value, onChange, lock, labels }: {
  idPrefix: string; value: WorkRange; onChange: (next: { days: number[]; from: Clock; to: Clock }) => void; lock?: RangeLock;
  labels?: { days: string; from: string; to: string };
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'ar' ? 'ar' : 'en';
  const words = labels ?? { days: t('quietHours.days'), from: t('quietHours.from'), to: t('quietHours.to') };
  const lockedDays = lock?.on ? lock.days : [];
  const send = (next: Partial<{ days: readonly number[]; from: Clock; to: Clock }>) => {
    const days = [...(next.days ?? value.days)].sort((a, b) => a - b);
    onChange({ days, from: next.from ?? value.from, to: next.to ?? value.to });
  };
  const toggle = (day: number) => {
    const on = value.days.includes(day);
    if (on && value.days.length === 1) return;
    send({ days: on ? value.days.filter((one) => one !== day) : [...value.days, day] });
  };
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={words.days} className="flex flex-col gap-1">
        <span className="text-footnote text-label-2">{words.days}</span>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((day) => {
            const locked = lockedDays.includes(day);
            const on = locked || value.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                id={`${idPrefix}-day-${day}`}
                aria-pressed={on}
                aria-label={weekdayName(day, lang, 'long')}
                title={locked ? t('quietHours.lockedDay') : undefined}
                disabled={locked || (on && value.days.length === 1)}
                onClick={() => toggle(day)}
                className={`pressable inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-subheadline font-medium disabled:opacity-60 ${on ? 'bg-ink text-card' : 'bg-fill text-ink-2'}`}
              >
                {weekdayName(day, lang)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField id={`${idPrefix}-from`} label={words.from} value={value.from} onChange={(event) => send({ from: event.target.value })}>
          {startOptions(value, lock).map((step) => <option key={step} value={step}>{clockLabel(step, lang)}</option>)}
        </SelectField>
        <SelectField id={`${idPrefix}-to`} label={words.to} value={value.to} onChange={(event) => send({ to: event.target.value })}>
          {endOptions(value, lock).map((step) => <option key={step} value={step}>{clockLabel(step, lang)}</option>)}
        </SelectField>
      </div>
    </div>
  );
}
