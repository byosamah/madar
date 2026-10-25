import { useTranslation } from 'react-i18next';
import { useSwitchLanguage } from '../../app/languageTurn';
import { PROTOTYPE } from '../../app/mode';
import { useAction, useCall } from '../../app/runtime';
import { ScreenTitle } from '../../components/ScreenTitle';
import { SegmentedControl } from '../../components/SegmentedControl';
import { AdminReachSection } from './AdminReachSection';
import { AgentsSection } from './AgentsSection';
import { GoogleCalendarSection } from './GoogleCalendarSection';
import { NotificationsSection } from './NotificationsSection';
import { PasswordSection } from './PasswordSection';
import { PrototypeTools } from './PrototypeTools';
import { PushSection } from './PushSection';
import { QuietHoursSection } from './QuietHoursSection';
import { ProfileSection } from './ProfileSection';
import { SettingsSection as Section } from './Section';
import { UsageDataSection } from './UsageDataSection';

export function SettingsScreen() {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const preferences = useAction('me.updatePreferences');
  const switchLanguage = useSwitchLanguage();
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
      {/* Quiet hours: no push and no email outside the work hours of the person (owner, 2026-10-22, fbk_048). */}
      <QuietHoursSection />
      {/* Google Calendar: each meeting of the person goes to the calendar "Madar" in their Google account (fbk_022, owner 2026-10-19). */}
      <GoogleCalendarSection />

      {/* The real build: the password (track U) and the person's agents (track G). The prototype has no sign-in, so no password. */}
      <PasswordSection />
      <AgentsSection />

      {/* What Madar records, in one line for every person (insight design, owner 2026-10-25). It has no control. */}
      <UsageDataSection />

      {/* The prototype controls stay out of the real build (client map 6). */}
      {PROTOTYPE && <Section title={t('settings.prototype')}><PrototypeTools /></Section>}
    </div>
  );
}
