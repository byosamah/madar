import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TRIGGERS } from '../../api/contract/entities';
import { fieldError } from '../../app/errors';
import { useSwitchLanguage } from '../../app/languageTurn';
import { PreviewAs } from '../../app/PreviewAs';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { ScreenTitle } from '../../components/ScreenTitle';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel flex flex-col gap-3 p-5">
      <h2 className="text-section text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useCall('session.get', {});
  const preferences = useAction('me.updatePreferences');
  const switchLanguage = useSwitchLanguage();
  const profile = useAction('me.updateProfile', { onSuccess: () => toast.show({ message: t('settings.saved') }) });
  const trigger = useAction('notifications.updateSettings');
  const simulate = useAction('session.setSimulateErrors');
  const reset = useAction('session.resetSampleData', { onSuccess: () => toast.show({ message: t('settings.resetDone') }) });
  const user = session.data?.user;
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('');

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setDiscipline(user.discipline);
  }, [user?.id, user?.name, user?.discipline]);

  if (!session.data || !user) return <ScreenTitle title={t('screens.settings')} />;
  const prefs = user.preferences;

  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('screens.settings')} />

      <Section title={t('settings.profile')}>
        <div className="flex items-center gap-4">
          <Avatar user={user} size={56} />
          <span className="min-w-0 truncate text-footnote text-label-2">{user.email}</span>
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            profile.mutate({ name, discipline });
          }}
        >
          {/* A refused field shows its message under it, as in the Admin forms (audit 2026-10-03, SHL-22). */}
          <TextField
            id="profile-name"
            label={t('settings.name')}
            value={name}
            dir="auto"
            className="flex-1"
            error={fieldError(profile.error, 'name', t, t('admin.errors.name'))}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            id="profile-discipline"
            label={t('settings.discipline')}
            value={discipline}
            dir="auto"
            className="flex-1"
            error={fieldError(profile.error, 'discipline', t, t('admin.errors.discipline'))}
            onChange={(event) => setDiscipline(event.target.value)}
          />
          <Button type="submit">{t('settings.save')}</Button>
        </form>
      </Section>

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

      <Section title={t('settings.notifications')}>
        {TRIGGERS.map((name) => (
          <Switch
            key={name}
            id={`trigger-${name}`}
            label={t(`settings.triggers.${name}`)}
            checked={session.data.authority.preferences.notifications[name]}
            onChange={(on) => trigger.mutate({ trigger: name, on })}
          />
        ))}
      </Section>


      <Section title={t('settings.prototype')}>
        <PreviewAs id="preview-as-settings" />
        <Switch
          id="simulate-errors"
          label={t('settings.simulateErrors')}
          description={t('settings.simulateErrorsHint')}
          checked={session.data.simulateErrors}
          onChange={(on) => simulate.mutate({ on })}
        />
        <div>
          <Button onClick={() => reset.mutate({})}>{t('settings.reset')}</Button>
        </div>
      </Section>
    </div>
  );
}
