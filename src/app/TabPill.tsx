import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Badge } from '../components/Badge';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { spring } from '../design/motion';
import { NAV, NOTIFICATIONS_ITEM, SEARCH_ITEM, isNavActive } from './nav';
import { useCall } from './runtime';
import { useCompactBars } from './useCompactBars';
import { useIsPhone } from './useIsPhone';

/** The floating pill (redesign spec 2.5): top center from 640 px, bottom center on a phone. The open tab carries the signature. */
export function TabPill() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const unreadChats = useCall('chats.unreadCount', {}).data?.unread ?? 0;
  const compact = useCompactBars();
  // From 640 px the Inbox is a round icon beside Search and the bell (owner, 2026-10-01). On a phone it stays a tab.
  const phone = useIsPhone();
  return (
    <nav
      aria-label={t('nav.main')}
      data-pill
      data-compact={compact || undefined}
      className={`pill fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-[calc(100vw-24px)] max-w-md items-center gap-0.5 sm:w-max sm:max-w-none rounded-full p-1.5 origin-bottom motion-safe:transition-transform motion-safe:duration-300 sm:bottom-auto sm:top-4 sm:origin-top ${compact ? 'max-sm:motion-safe:scale-[0.94]' : ''}`}
    >
      {NAV.filter((item) => phone || !item.badge).map((item) => {
        const active = isNavActive(item.to, pathname);
        const Moving = item.animated;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative isolate flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-caption font-semibold sm:min-h-11 sm:flex-none sm:flex-row sm:px-4 sm:text-subheadline ${active ? 'text-[var(--on-sig)]' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && <motion.span layoutId="pill-active" transition={spring.standard} className="signature absolute inset-0 -z-10 rounded-full" />}
            <AnimatedIcon icon={Moving} size={20} className="sm:hidden" playWhen={active} aria-hidden />
            <span className="whitespace-nowrap">{t(item.key)}</span>
            {item.badge && unreadChats > 0 && <Badge count={unreadChats} label={t('nav.inboxUnread', { count: unreadChats })} className="absolute -top-0.5 end-0 sm:static sm:ms-1.5" />}
          </Link>
        );
      })}
      <SearchButton className="max-sm:hidden" />
      {!phone && <InboxButton />}
      <BellButton className="max-sm:hidden" />
    </nav>
  );
}

/** Search, round. In the tab pill from 640 px; on a phone it sits at the top beside the person's picture. */
export function SearchButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const SearchTab = SEARCH_ITEM.animated;
  const { pathname } = useLocation();
  const on = pathname === SEARCH_ITEM.to;
  return (
    <Link
      to={SEARCH_ITEM.to}
      aria-label={t(SEARCH_ITEM.key)}
      aria-current={on ? 'page' : undefined}
      className={`pressable grid size-11 shrink-0 place-items-center rounded-full ${on ? 'bg-fill text-ink' : 'text-ink-2 hover:text-ink'} ${className}`}
    >
      <AnimatedIcon icon={SearchTab} size={20} playWhen={on} aria-hidden />
    </Link>
  );
}

/** The chat Inbox as a round icon with its unread count, from 640 px (owner, 2026-10-01). */
export function InboxButton() {
  const { t } = useTranslation();
  const item = NAV.find((entry) => entry.badge)!;
  const { pathname } = useLocation();
  const unread = useCall('chats.unreadCount', {}).data?.unread ?? 0;
  const on = isNavActive(item.to, pathname);
  return (
    <Link
      to={item.to}
      aria-label={t(item.key)}
      aria-current={on ? 'page' : undefined}
      className={`pressable relative grid size-11 shrink-0 place-items-center rounded-full ${on ? 'bg-fill text-ink' : 'text-ink-2 hover:text-ink'}`}
    >
      <AnimatedIcon icon={item.animated} size={20} playWhen={on} aria-hidden />
      {unread > 0 && <Badge count={unread} label={t('nav.inboxUnread', { count: unread })} className="absolute -top-1 -end-1" />}
    </Link>
  );
}

/** The notifications bell with its red count. In the tab pill from 640 px; on a phone it sits at the top. */
export function BellButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const BellTab = NOTIFICATIONS_ITEM.animated;
  const { pathname } = useLocation();
  const noticeBadge = useCall('notifications.count', {}).data?.badge ?? 0;
  const on = pathname === NOTIFICATIONS_ITEM.to;
  return (
    <Link
      to={NOTIFICATIONS_ITEM.to}
      aria-label={t(NOTIFICATIONS_ITEM.key)}
      aria-current={on ? 'page' : undefined}
      className={`pressable relative grid size-11 shrink-0 place-items-center rounded-full ${on ? 'bg-fill text-ink' : 'text-ink-2 hover:text-ink'} ${className}`}
    >
      <AnimatedIcon icon={BellTab} size={20} playWhen={on} aria-hidden />
      {noticeBadge > 0 && <Badge count={noticeBadge} label={t('nav.inboxBadge', { count: noticeBadge })} className="absolute -top-1 -end-1" />}
    </Link>
  );
}
