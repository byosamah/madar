import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Switch } from '../../components/Switch';
import type { Lang } from '../../lib/dates';
import { officeWorkHoursOf, type WorkHours } from '../../lib/quietHours';
import { SettingsSection } from './Section';
import { WorkRangeFields } from './WorkRangeFields';
import { clockLabel, daysPhrase, effectiveWorkHours, quietSentence } from './workRange';

/**
 * Settings, "When Madar notifies you" (owner, 2026-10-22, fbk_048; words of fbk_049). One switch, "Notify me only in my work hours" (on
 * by default), then the work days and the two times: the hours that notify. Outside them Madar sends no push and no email, and the bell
 * keeps everything; one line spells out that quiet time. While the Admin keeps notifications on (the lock), the days and hours of the lock
 * stay inside the range: the day toggles are locked and the times cannot cut the lock. Each change saves at once with a toast. With the
 * switch off, the day and time controls hide, and the line says that Madar notifies at any time.
 */
export function QuietHoursSection() {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'ar' ? 'ar' : 'en';
  const toast = useToast();
  const session = useCall('session.get', {});
  const settings = useCall('settings.get', {});
  const save = useAction('me.updatePreferences', { onSuccess: () => toast.show({ message: t('quietHours.saved') }) });
  const user = session.data?.user;
  if (!user || !settings.data) return null;
  const { lock } = officeWorkHoursOf(settings.data);
  // The range as the screen shows it and saves it: it always holds the lock, also when the Admin moved the lock after the person chose.
  const shown = effectiveWorkHours(user.preferences, settings.data);
  const commit = (next: Partial<WorkHours>) => save.mutate({ workHours: { ...shown, ...next } });

  return (
    <SettingsSection title={t('quietHours.title')}>
      <Switch id="quiet-hours" label={t('quietHours.switch')} checked={shown.quiet} onChange={(quiet) => commit({ quiet })} />
      {shown.quiet && <WorkRangeFields idPrefix="quiet" order="quiet" value={shown} lock={lock} onChange={(range) => commit(range)} />}
      <p className="text-subheadline text-ink">{quietSentence(shown, lang, t)}</p>
      {shown.quiet && lock.on && (
        <p className="text-footnote text-label-2">
          {t('quietHours.lockLine', { days: daysPhrase(lock.days, lang, t), from: clockLabel(lock.from, lang), to: clockLabel(lock.to, lang) })}
        </p>
      )}
    </SettingsSection>
  );
}
