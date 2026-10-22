import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOTE } from '../../app/mode';
import { canInstall, onInstallChange, promptInstall } from '../../app/remote/install';
import { useIsPhone } from '../../app/useIsPhone';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { BellIcon } from '../../components/icons/animated/bell';
import { FormError } from '../auth/AuthPage';
import { usePushDevice } from '../settings/usePushDevice';

/**
 * The one ask for browser push on Home (owner, 2026-10-09). Push is on by default, but a browser lets a page turn it on only after
 * a tap on Allow. So a device that was never asked shows one short line and one button. The tap starts the browser question. Any
 * answer ends the ask: Allow turns push on, and Block leaves the note in Settings. A closed question leaves the ask in place. After
 * Allow the check at the start of the app turns push on again by itself, for example after each sign-in. It is not the main button
 * of Home. The prototype has no server to push, so it shows in the real build only.
 *
 * The Home Screen (owner, 2026-10-20), one next step for each phone, until the store app comes:
 * - An iPhone or iPad in a browser tab cannot push. The card shows the 3 steps to the Home Screen, with no button: Apple lets no page
 *   start the install. Once Madar opens from the Home Screen, the ask above shows there.
 * - On Android, after the answer about push, the card shows one button that opens the install box of Chrome
 *   (src/app/remote/install.ts). Any answer ends it.
 */
export function PushAskCard() {
  return REMOTE ? <Ask /> : null;
}

function Ask() {
  const push = usePushDevice();
  const installable = useSyncExternalStore(onInstallChange, canInstall, () => false);
  if (push.askable) return <PushAsk push={push} />;
  if (push.status === 'needs_install') return <HomeScreenSteps />;
  // The first check of push decides first, so the install button never shows before the ask.
  if (installable && push.status !== null) return <InstallAsk />;
  return null;
}

function PushAsk({ push }: { push: ReturnType<typeof usePushDevice> }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const line = <p className="text-subheadline text-ink-2">{t('push.ask')}</p>;
  return (
    <section aria-label={t('push.title')} className="panel flex flex-col gap-3 px-5 py-4">
      {/* On a phone a bell starts the line (Direction D). It plays once when the card shows. The other two cards have none. */}
      {phone ? (
        <div className="flex items-start gap-3">
          <AnimatedIcon icon={BellIcon} size={20} playWhen className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
          {line}
        </div>
      ) : line}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={push.busy} onClick={push.turnOn}>{t('push.askButton')}</Button>
        <FormError text={push.failure === 'on' ? t('push.error') : null} />
      </div>
    </section>
  );
}

function HomeScreenSteps() {
  const { t } = useTranslation();
  return (
    <section aria-label={t('push.title')} className="panel flex flex-col gap-3 px-5 py-4">
      <p className="text-subheadline text-ink-2">{t('push.homeScreenLine')}</p>
      <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-subheadline text-ink-2">
        <li>{t('push.homeScreenStep1')}</li>
        <li>{t('push.homeScreenStep2')}</li>
        <li>{t('push.homeScreenStep3')}</li>
      </ol>
    </section>
  );
}

function InstallAsk() {
  const { t } = useTranslation();
  return (
    <section aria-label={t('push.installTitle')} className="panel flex flex-col gap-3 px-5 py-4">
      <p className="text-subheadline text-ink-2">{t('push.installLine')}</p>
      <div className="flex flex-wrap items-center gap-3">
        {/* promptInstall opens the box of Chrome as its first step, so it must start in the tap. */}
        <Button onClick={() => void promptInstall()}>{t('push.installButton')}</Button>
      </div>
    </section>
  );
}
