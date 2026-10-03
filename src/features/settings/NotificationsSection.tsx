import { useTranslation } from 'react-i18next';
import { TRIGGERS } from '../../api/contract/entities';
import { useAction, useCall } from '../../app/runtime';
import { Switch } from '../../components/Switch';
import { SettingsSection } from './Section';

/**
 * The in-app notification switches, one for each trigger. They follow the person whose choices apply (the authority).
 * Track N2 adds the email switches and the morning summary here (plan 5.4).
 */
export function NotificationsSection() {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const trigger = useAction('notifications.updateSettings');
  if (!session.data) return null;
  const notifications = session.data.authority.preferences.notifications;
  return (
    <SettingsSection title={t('settings.notifications')}>
      {TRIGGERS.map((name) => (
        <Switch
          key={name}
          id={`trigger-${name}`}
          label={t(`settings.triggers.${name}`)}
          checked={notifications[name]}
          onChange={(on) => trigger.mutate({ trigger: name, on })}
        />
      ))}
    </SettingsSection>
  );
}
