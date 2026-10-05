import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../app/runtime';
import { SmallSwitch } from '../../components/Switch';

/**
 * The personal choice to hatch the days that two stages share, on every schedule (owner, 2026-10-05, item 9). A missing value
 * means on. The switch moves at once; the saved value takes over when the answer comes, and a refusal puts the switch back.
 */
export function useHatchOverlap(): readonly [boolean, (next: boolean) => void] {
  const saved = useHatchOn();
  const save = useAction('me.updatePreferences');
  const [wanted, setWanted] = useState<boolean | null>(null);
  useEffect(() => {
    if (wanted === saved) setWanted(null);
  }, [wanted, saved]);
  const set = (next: boolean) => {
    setWanted(next);
    save.mutate({ hatchOverlap: next }, { onError: () => setWanted(null) });
  };
  return [wanted ?? saved, set] as const;
}

/** The saved choice only, for a schedule with no switch of its own (the meeting view). */
export function useHatchOn(): boolean {
  return useCall('session.get', {}).data?.user.preferences.hatchOverlap !== false;
}

/** The one small switch beside the legend of the hatch. With the hatch off, it stays alone. */
export function HatchSwitch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return <SmallSwitch id={`hatch-${id}`} label={t('schedule.hatchSwitch')} checked={on} onChange={onChange} />;
}
