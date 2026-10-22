import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../components/icons/animated/chevron-left';
import { HomeMark } from './HomeMark';
import { backLinkOf } from './phoneBack';
import { isPhoneChatPath } from './phoneChat';
import { useCall } from './runtime';
import { SearchButton } from './TabPill';
import { useIsPhone } from './useIsPhone';
import { useRight } from './useRight';

/**
 * The top row of a phone (Direction D): the Madar mark, or the back link of its screen, and one Search icon. No bell and no
 * person picture. A desk hides the row with a class. An open chat has no row.
 */
export function PhoneTopRow() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const phone = useIsPhone();
  const mayDashboard = useRight('dashboard.view');
  const isAdmin = useCall('session.get', {}).data?.authority.systemRole === 'admin';
  if (phone && isPhoneChatPath(pathname)) return null;
  const found = backLinkOf(pathname, { mayDashboard, isAdmin });
  // A desk keeps the DOM of before: only the project back link shows in the (hidden) row.
  const back = found && (phone || found.key === 'project.back') ? found : null;
  return (
    <div className="-me-1.5 flex items-center justify-end gap-0.5 pb-1 sm:hidden">
      {!back && <HomeMark className="-ms-1 me-auto" />}
      {back && (
        <Link to={back.to} className="pressable -ms-2 me-auto inline-flex min-h-11 items-center gap-0.5 rounded-full pe-3 ps-1 text-subheadline font-semibold text-link">
          <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
          {t(back.key)}
        </Link>
      )}
      <SearchButton />
    </div>
  );
}
