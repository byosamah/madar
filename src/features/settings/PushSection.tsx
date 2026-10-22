import { useTranslation } from 'react-i18next';
import { REMOTE } from '../../app/mode';
import type { PushStatus } from '../../app/remote/push';
import { Switch } from '../../components/Switch';
import { FormError } from '../auth/AuthPage';
import { SettingsSection as Section } from './Section';
import { usePushDevice } from './usePushDevice';

/**
 * Settings, Notifications on this device (owner, 2026-10-08): the one switch of browser push. On this browser, the switch gets a
 * short line when a new notice or a new message comes. No switch for a kind of notice. The prototype has no server to push, so the
 * section shows in the real build only.
 *
 * Where the browser cannot push, the section says why and shows no switch: the person has no control that would do nothing.
 */
export function PushSection() {
  return REMOTE ? <Push /> : null;
}

/** The word that explains a state that has no switch. The Me hub reuses it. */
export const PUSH_NOTE: Partial<Record<PushStatus, string>> = {
  unsupported: 'push.unsupported', needs_install: 'push.needsInstall', not_set: 'push.notSet', blocked: 'push.blocked',
};

function Push() {
  const { t } = useTranslation();
  const push = usePushDevice();
  const note = push.status ? PUSH_NOTE[push.status] : undefined;
  const hasSwitch = push.status === 'off' || push.status === 'on';

  return (
    <Section title={t('push.title')}>
      {hasSwitch && (
        <Switch
          id="push-device"
          label={t('push.switch')}
          description={t('push.hint')}
          checked={push.status === 'on'}
          onChange={(next) => {
            if (push.busy) return;
            if (next) push.turnOn();
            else push.turnOff();
          }}
        />
      )}
      {note && <p role="status" className="text-body text-label-2">{t(note)}</p>}
      <FormError text={push.failure === 'on' ? t('push.error') : push.failure === 'off' ? t('push.offError') : null} />
    </Section>
  );
}
