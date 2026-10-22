import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { useCall } from '../../app/runtime';
import { ScreenTitle } from '../../components/ScreenTitle';
import { BareProvider } from '../settings/bare';
import { meSectionOf } from './meSections';

/**
 * One section of the Me tab, at /me/:section (Direction D). It draws the page title and the section part of the Settings page. The
 * part keeps its h2 for a screen reader only (bare mode), because the page has the title. A desk never mounts this screen: the route
 * sends it to /settings (routes.tsx). An unknown section, and a section that the person may not use, go to the hub.
 */
export function MeSectionScreen() {
  const { t } = useTranslation();
  const { section } = useParams();
  const user = useCall('session.get', {}).data?.user;
  if (!user) return null;
  const found = meSectionOf(section, user);
  if (!found) return <Navigate to="/me" replace />;
  const { Component } = found;
  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t(found.titleKey)} />
      <BareProvider>
        <Component />
      </BareProvider>
    </div>
  );
}
