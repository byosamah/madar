import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { morningSummaryOn } from '../../api/notify';
import { useOnceOn } from '../../app/lazyOverlay';
import { REMOTE } from '../../app/mode';
import { canInstall, onInstallChange, promptInstall } from '../../app/remote/install';
import { useAction, useCall } from '../../app/runtime';
import { BellIcon } from '../../components/icons/animated/bell';
import { CalendarDaysIcon } from '../../components/icons/animated/calendar-days';
import { HomeIcon } from '../../components/icons/animated/home';
import { ShieldCheckIcon } from '../../components/icons/animated/shield-check';
import { SlidersHorizontalIcon } from '../../components/icons/animated/sliders-horizontal';
import { SunIcon } from '../../components/icons/animated/sun';
import { TimerIcon } from '../../components/icons/animated/timer';
import { UsersIcon } from '../../components/icons/animated/users';
import { WaypointsIcon } from '../../components/icons/animated/waypoints';
import { FormError } from '../auth/AuthPage';
import { PUSH_NOTE } from '../settings/PushSection';
import { usePushDevice } from '../settings/usePushDevice';
import { HomeScreenSheet } from './HomeScreenSheet';
import { MePanel, MeRow, MeSwitchRow } from './MeRow';
import { useMeSummary } from './useMeSummary';

/**
 * The push row and the Home Screen row, which share one check of the browser (real build only).
 * - Push: a switch only where this browser can push (off or on). Where it cannot, the row has no switch and a status line gives the
 *   reason. While the first check runs, the row has no switch and no line. A needs-install iPhone gets no line here: the next row
 *   carries the step.
 * - The Home Screen row shows when it helps. On an iPhone or iPad in a browser tab a press opens the three steps. On Android, when
 *   Chrome holds the install event, a press opens the install box of Chrome. Else the row is absent.
 */
function DeviceRows() {
  const { t } = useTranslation();
  const push = usePushDevice();
  const installable = useSyncExternalStore(onInstallChange, canInstall, () => false);
  const [steps, setSteps] = useState(false);
  // The sheet mounts at the first press and stays, so its closing animation stays.
  const stepsMounted = useOnceOn(steps);
  const note = push.status && push.status !== 'needs_install' ? PUSH_NOTE[push.status] : undefined;
  const hasSwitch = push.status === 'off' || push.status === 'on';
  const failure = push.failure === 'on' ? t('push.error') : push.failure === 'off' ? t('push.offError') : null;
  const homeScreen = push.status === 'needs_install' ? 'steps' : installable && push.status !== null ? 'install' : null;
  return (
    <>
      <MeSwitchRow
        id="push-device"
        icon={BellIcon}
        title={t('push.switch')}
        checked={push.status === 'on'}
        showSwitch={hasSwitch}
        onChange={(next) => {
          if (push.busy) return;
          if (next) push.turnOn();
          else push.turnOff();
        }}
        note={(
          <>
            {note && <p role="status" className="text-footnote text-ink-2">{t(note)}</p>}
            <FormError text={failure} />
          </>
        )}
      />
      {homeScreen && (
        // promptInstall opens the box of Chrome as its first step, so it must start inside the press.
        <MeRow icon={HomeIcon} title={t('phoneMe.homeScreenRow')} onPress={() => (homeScreen === 'steps' ? setSteps(true) : void promptInstall())} />
      )}
      {stepsMounted && <HomeScreenSheet open={steps} onOpenChange={setSteps} />}
    </>
  );
}

/** The Morning summary switch (real build only). It reads morningSummaryOn and saves at once. */
function MorningRow() {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const save = useAction('notifications.updateSettings');
  if (!session.data) return null;
  return (
    <MeSwitchRow
      id="morning-summary"
      icon={SunIcon}
      title={t('notices.summary')}
      lines={[t('notices.summaryHint')]}
      checked={morningSummaryOn(session.data.authority.preferences)}
      onChange={(on) => save.mutate({ morningSummary: on })}
    />
  );
}

/**
 * Panel 3 of the hub, in order: push on this device, the Home Screen, Quiet hours, the kinds of notice, the Morning summary, and
 * What reaches me (the Admin role only). Each row shows its state under the title, so the person need not open it.
 */
export function NoticePanel() {
  const { t } = useTranslation();
  const summary = useMeSummary();
  return (
    <MePanel>
      {REMOTE && <DeviceRows />}
      <MeRow icon={TimerIcon} title={t('quietHours.title')} lines={summary.quiet ? [summary.quiet] : undefined} to="/me/quiet-hours" />
      <MeRow icon={SlidersHorizontalIcon} title={t('settings.notifications')} lines={[summary.notices]} to="/me/notices" />
      {REMOTE && <MorningRow />}
      {summary.reach !== null && <MeRow icon={UsersIcon} title={t('adminReach.title')} value={summary.reach} to="/me/reach" />}
    </MePanel>
  );
}

/**
 * Panel 4 of the hub: Google Calendar, and in the real build the password and the agents. The Agents row stays also without the right
 * to connect, because the person must still remove old agents.
 */
export function AccountPanel() {
  const { t } = useTranslation();
  const summary = useMeSummary();
  return (
    <MePanel>
      <MeRow icon={CalendarDaysIcon} title={t('gcal.title')} value={summary.gcal ?? undefined} to="/me/calendar" />
      {REMOTE && <MeRow icon={ShieldCheckIcon} title={t('password.title')} to="/me/password" />}
      {REMOTE && <MeRow icon={WaypointsIcon} title={t('agents.title')} to="/me/agents" />}
    </MePanel>
  );
}
