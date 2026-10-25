import { useTranslation } from 'react-i18next';
import { useCall } from '../../app/runtime';
import { ScreenTitle } from '../../components/ScreenTitle';
import { MeGroup } from './MeRow';
import { AccountPanel, NoticePanel } from './NoticePanel';
import { OfficeGroup, PrototypeGroup, SignOutButton } from './OfficeGroup';
import { UsageDataNote } from '../settings/UsageDataSection';
import { LookPanel, ProfilePanel } from './PersonPanels';

/**
 * The Me tab of a phone (Direction D): the hub that replaces the Settings page and the person menu. A desk never mounts it: the
 * route sends it to /settings (routes.tsx). It has no main button. While the session has no answer, only the title shows, and
 * the rows fill in later with no spinner.
 */
export function MeScreen() {
  const { t } = useTranslation();
  const user = useCall('session.get', {}).data?.user;
  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('phoneMe.title')} />
      {user && (
        <>
          <ProfilePanel />
          <MeGroup title={t('phoneMe.groupSettings')}>
            <LookPanel />
            <NoticePanel />
            <AccountPanel />
          </MeGroup>
          <OfficeGroup />
          <PrototypeGroup />
          <SignOutButton />
          {/* What Madar records, as quiet text at the end (insight design, owner 2026-10-25). */}
          <UsageDataNote />
        </>
      )}
    </div>
  );
}
