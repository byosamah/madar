import type { ComponentType } from 'react';
import type { SystemRole } from '../../api/contract/entities';
import { REMOTE } from '../../app/mode';
import { useCall } from '../../app/runtime';
import { AdminReachSection } from '../settings/AdminReachSection';
import { AgentsSection } from '../settings/AgentsSection';
import { GoogleCalendarSection } from '../settings/GoogleCalendarSection';
import { NotificationsSection } from '../settings/NotificationsSection';
import { PasswordSection } from '../settings/PasswordSection';
import { ProfileSection } from '../settings/ProfileSection';
import { QuietHoursSection } from '../settings/QuietHoursSection';

export type MeSectionId = 'profile' | 'reach' | 'notices' | 'quiet-hours' | 'calendar' | 'password' | 'agents';

export type MeSection = {
  id: MeSectionId;
  /** The key of the page title. It is the title key that the section has on the desk. */
  titleKey: string;
  Component: ComponentType;
  /** Whether this person may open the section. `remote` is the build: the prototype has no sign-in, so no password and no agents. */
  allowed(viewer: { systemRole: SystemRole }, remote: boolean): boolean;
};

/** The profile part needs the person, so a small component reads the session for it. */
function ProfilePage() {
  const user = useCall('session.get', {}).data?.user;
  return user ? <ProfileSection user={user} /> : null;
}

const open = () => true;

/** The sub-pages of the Me tab at /me/:section. The order is the order of the hub rows. */
export const ME_SECTIONS: readonly MeSection[] = [
  { id: 'profile', titleKey: 'settings.profile', Component: ProfilePage, allowed: open },
  { id: 'reach', titleKey: 'adminReach.title', Component: AdminReachSection, allowed: (viewer) => viewer.systemRole === 'admin' },
  { id: 'notices', titleKey: 'settings.notifications', Component: NotificationsSection, allowed: open },
  { id: 'quiet-hours', titleKey: 'quietHours.title', Component: QuietHoursSection, allowed: open },
  { id: 'calendar', titleKey: 'gcal.title', Component: GoogleCalendarSection, allowed: open },
  { id: 'password', titleKey: 'password.title', Component: PasswordSection, allowed: (_viewer, remote) => remote },
  { id: 'agents', titleKey: 'agents.title', Component: AgentsSection, allowed: (_viewer, remote) => remote },
];

/** The section of an address that this person may open, or undefined (an unknown name, or a section they may not use). */
export function meSectionOf(id: string | undefined, viewer: { systemRole: SystemRole }, remote: boolean = REMOTE): MeSection | undefined {
  const found = ME_SECTIONS.find((section) => section.id === id);
  return found?.allowed(viewer, remote) ? found : undefined;
}
