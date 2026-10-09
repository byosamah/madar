import { useTranslation } from 'react-i18next';
import { REMOTE } from '../../app/mode';
import { Button } from '../../components/Button';
import { FormError } from '../auth/AuthPage';
import { usePushDevice } from '../settings/usePushDevice';

/**
 * The one ask for browser push on Home (owner, 2026-10-09). Push is on by default, but a browser lets a page turn it on only after
 * a tap on Allow. So a device that was never asked shows one short line and one button. The tap starts the browser question. Any
 * answer ends the ask: Allow turns push on, and Block leaves the note in Settings. A closed question leaves the ask in place. After
 * Allow the check at the start of the app turns push on again by itself, for example after each sign-in. It is not the main button
 * of Home. The prototype has no server to push, so it shows in the real build only.
 */
export function PushAskCard() {
  return REMOTE ? <Ask /> : null;
}

function Ask() {
  const { t } = useTranslation();
  const push = usePushDevice();
  if (!push.askable) return null;
  return (
    <section aria-label={t('push.title')} className="panel flex flex-col gap-3 px-5 py-4">
      <p className="text-subheadline text-ink-2">{t('push.ask')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={push.busy} onClick={push.turnOn}>{t('push.askButton')}</Button>
        <FormError text={push.failure === 'on' ? t('push.error') : null} />
      </div>
    </section>
  );
}
