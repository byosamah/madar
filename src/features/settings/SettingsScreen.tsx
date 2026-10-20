import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSwitchLanguage } from '../../app/languageTurn';
import { PROTOTYPE } from '../../app/mode';
import { PreviewAs } from '../../app/PreviewAs';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { ScreenTitle } from '../../components/ScreenTitle';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Sheet } from '../../components/Sheet';
import { Switch } from '../../components/Switch';
import { AdminReachSection } from './AdminReachSection';
import { AgentsSection } from './AgentsSection';
import { GoogleCalendarSection } from './GoogleCalendarSection';
import { NotificationsSection } from './NotificationsSection';
import { PasswordSection } from './PasswordSection';
import { PushSection } from './PushSection';
import { ProfileSection } from './ProfileSection';
import { SettingsSection as Section } from './Section';

export function SettingsScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useCall('session.get', {});
  const preferences = useAction('me.updatePreferences');
  const switchLanguage = useSwitchLanguage();
  const simulate = useAction('session.setSimulateErrors');
  // Reset wipes the whole office in this browser and has no Undo, so it asks first, like Delete project (audit 2026-10-03, SHL-8).
  const [askReset, setAskReset] = useState(false);
  const reset = useAction('session.resetSampleData', {
    onSuccess: () => {
      setAskReset(false);
      toast.show({ message: t('settings.resetDone') });
    },
  });
  const user = session.data?.user;

  if (!session.data || !user) return <ScreenTitle title={t('screens.settings')} />;
  const prefs = user.preferences;

  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('screens.settings')} />

      <ProfileSection user={user} />

      <Section title={t('settings.language')}>
        <SegmentedControl
          label={t('settings.language')}
          value={prefs.language}
          options={(['en', 'ar'] as const).map((value) => ({ value, label: t(`settings.languages.${value}`) }))}
          onChange={switchLanguage}
        />
      </Section>

      <Section title={t('settings.theme')}>
        <SegmentedControl
          label={t('settings.theme')}
          value={prefs.theme}
          options={(['system', 'light', 'dark'] as const).map((value) => ({ value, label: t(`settings.themes.${value}`) }))}
          onChange={(theme) => preferences.mutate({ theme })}
        />
      </Section>

      {/* The Admin only: what reaches the Admin (owner, 2026-10-23). It sits before the switches of the notices. */}
      <AdminReachSection />
      <NotificationsSection />
      {/* The real build: browser push on this device (owner, 2026-10-08). */}
      <PushSection />
      {/* Google Calendar: each meeting of the person goes to the calendar "Madar" in their Google account (fbk_022, owner 2026-10-19). */}
      <GoogleCalendarSection />

      {/* The real build: the password (track U) and the person's agents (track G). The prototype has no sign-in, so no password. */}
      <PasswordSection />
      <AgentsSection />

      {/* The prototype controls stay out of the real build (client map 6). */}
      {PROTOTYPE && <Section title={t('settings.prototype')}>
        <PreviewAs id="preview-as-settings" />
        <Switch
          id="simulate-errors"
          label={t('settings.simulateErrors')}
          description={t('settings.simulateErrorsHint')}
          checked={session.data.simulateErrors}
          onChange={(on) => simulate.mutate({ on })}
        />
        <div>
          <Button onClick={() => setAskReset(true)}>{t('settings.reset')}</Button>
        </div>
        <Sheet
          open={askReset}
          onOpenChange={setAskReset}
          title={t('settings.resetTitle')}
          description={t('settings.resetBody')}
          footer={(
            <>
              <Button onClick={() => setAskReset(false)}>{t('common.cancel')}</Button>
              <Button variant="destructive" disabled={reset.isPending} onClick={() => reset.mutate({})}>{t('settings.reset')}</Button>
            </>
          )}
        >
          {null}
        </Sheet>
      </Section>}
    </div>
  );
}
