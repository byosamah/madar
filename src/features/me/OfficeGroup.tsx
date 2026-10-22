import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can } from '../../api/permissions';
import { opensAdminPage } from '../../api/rights';
import { PROTOTYPE, REMOTE } from '../../app/mode';
import { useCall } from '../../app/runtime';
import { useRight } from '../../app/useRight';
import { Button } from '../../components/Button';
import { LayoutGridIcon } from '../../components/icons/animated/layout-grid';
import { MessageSquarePlusIcon } from '../../components/icons/animated/message-square-plus';
import { ShieldCheckIcon } from '../../components/icons/animated/shield-check';
import { SparklesIcon } from '../../components/icons/animated/sparkles';
import { WHATS_NEW } from '../../whatsNew/entries';
import { hasNew, readSeen } from '../../whatsNew/seen';
import { useSignOut } from '../auth/signOut';
import { useFeedbackSheet } from '../feedback/useFeedbackSheet';
import { PrototypeTools } from '../settings/PrototypeTools';
import { MeGroup, MePanel, MeRow } from './MeRow';

/**
 * The group "Office" of the hub: the Dashboard, the Admin page (or "Office" for another role), What's new and the feedback sheet. Each
 * row shows only for a person who may use it. What's new shows the word New, in ink, until the person opens the page.
 */
export function OfficeGroup() {
  const { t } = useTranslation();
  const session = useCall('session.get', {}).data;
  const dashboard = useRight('dashboard.view');
  const mayReport = session !== undefined && can(session.authority, 'feedback.send');
  const feedbackRow = useRef<HTMLButtonElement>(null);
  const feedback = useFeedbackSheet(feedbackRow);
  if (!session) return null;
  const admin = opensAdminPage(session.authority);
  return (
    <MeGroup title={t('phoneMe.groupOffice')}>
      <MePanel label={t('phoneMe.groupOffice')}>
        {dashboard && <MeRow icon={LayoutGridIcon} title={t('nav.dashboard')} lines={[t('phoneMe.dashboardLine')]} to="/dashboard" />}
        {admin && (
          <MeRow
            icon={ShieldCheckIcon}
            title={session.authority.systemRole === 'admin' ? t('nav.admin') : t('adminPage.officeTitle')}
            lines={[t('phoneMe.adminBest')]}
            to="/admin"
          />
        )}
        <MeRow
          icon={SparklesIcon}
          title={t('whatsNew.menu')}
          value={hasNew(WHATS_NEW, readSeen(session.user.id)) ? t('whatsNew.newMark') : undefined}
          to="/whats-new"
        />
        {mayReport && <MeRow icon={MessageSquarePlusIcon} title={t('feedback.menu')} onPress={feedback.open} buttonRef={feedbackRow} />}
      </MePanel>
      {feedback.sheet}
    </MeGroup>
  );
}

/** The group "Prototype" (prototype build only): Preview as, Simulate errors and Reset sample data, at the end of the hub. */
export function PrototypeGroup() {
  const { t } = useTranslation();
  if (!PROTOTYPE) return null;
  return (
    <MeGroup title={t('settings.prototype')}>
      <MePanel label={t('settings.prototype')}>
        <li className="flex flex-col gap-3 px-4 py-3">
          <PrototypeTools />
        </li>
      </MePanel>
    </MeGroup>
  );
}

/**
 * Sign out (real build only): a full-width quiet button, last on the page. It asks nothing, as the person menu did. The call can take
 * up to 4 seconds (the push device leaves first), so the button stays off meanwhile and a second press starts no second call. It works
 * again if the call ends without leaving the page, for example when it fails.
 */
export function SignOutButton() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!REMOTE) return null;
  const press = () => {
    if (running) return;
    setRunning(true);
    signOut()
      .catch(() => undefined)
      .finally(() => {
        if (alive.current) setRunning(false);
      });
  };
  return (
    <Button className="min-h-12 w-full" disabled={running} onClick={press}>{t('auth.signOut')}</Button>
  );
}
