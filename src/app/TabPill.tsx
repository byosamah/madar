import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Badge } from '../components/Badge';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { spring } from '../design/motion';
import { NAV, NOTIFICATIONS_ITEM, SEARCH_ITEM, isNavActive } from './nav';
import { usePressReads } from './pressReads';
import { useCall } from './runtime';
import { useCompactBars } from './useCompactBars';
import { useCan, useRight } from './useRight';
import { useIsPhone } from './useIsPhone';
import { PhoneTabBar } from './PhoneTabBar';

/** The floating pill (redesign spec 2.5): top center from 640 px. A phone gets its own bar with four tabs (PhoneTabBar). */
export function TabPill() {
  return useIsPhone() ? <PhoneTabBar /> : <DeskPill />;
}

/** The desk pill. The open tab carries the signature. */
function DeskPill() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const unreadChats = useCall('chats.unreadCount', {}).data?.unread ?? 0;
  const compact = useCompactBars();
  // From 640 px the Inbox is a round icon beside Search and the bell (owner, 2026-10-01). On a phone it stays a tab.
  const phone = useIsPhone();
  // A tab that needs a switch shows only to a person who holds it. Before the session arrives it shows (the route asks again).
  const may = useCan(true);
  const startReads = usePressReads();
  return (
    <nav
      aria-label={t('nav.main')}
      data-pill
      data-compact={compact || undefined}
      className={`pill fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-[calc(100vw-32px)] max-w-md items-center gap-0.5 sm:w-max sm:max-w-none rounded-full p-1.5 origin-bottom motion-safe:transition-transform motion-safe:duration-300 sm:bottom-auto sm:top-4 sm:origin-top ${compact ? 'max-sm:motion-safe:scale-[0.94]' : ''}`}
    >
      {NAV.filter((item) => (phone || !item.badge) && (!item.right || may(item.right))).map((item) => {
        const active = isNavActive(item.to, pathname);
        const Moving = item.animated;
        // On a phone each tab is one press area of 48 px with its icon in the centre, and the open tab is a round pill, the
        // shape of the bar (owner, 2026-10-20). The bar keeps the 16 px edge of the page. The word of the tab stays for screen
        // readers (owner, 2026-10-08). From 640 px up the tab shows its word and no icon.
        return (
          <Link
            key={item.to}
            to={item.to}
            onPointerDown={() => startReads(item.to)}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative isolate flex h-12 min-w-0 flex-1 items-center justify-center rounded-full font-semibold sm:h-11 sm:min-w-min sm:flex-none sm:gap-0.5 sm:px-4 sm:text-subheadline ${active ? 'text-[var(--on-sig)]' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && <motion.span layoutId="pill-active" transition={spring.standard} className="signature absolute inset-0 -z-10 rounded-full" />}
            {/* The word comes first, so a screen reader says the name before the count. On a phone it takes no space. */}
            <span className="sr-only leading-[1.15] sm:not-sr-only sm:whitespace-nowrap">{t(item.key)}</span>
            {/* The count of the Inbox sits on the corner of its icon. Only a phone has the Inbox tab, so it hides with the icon. */}
            <span data-tab-icon className="relative grid place-items-center sm:hidden">
              <AnimatedIcon icon={Moving} size={24} playWhen={active} aria-hidden />
              {item.badge && unreadChats > 0 && <Badge count={unreadChats} label={t('nav.inboxUnread', { count: unreadChats })} className="absolute -top-2 -end-3" />}
            </span>
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
  // On a phone this is the one search icon of the shell, and its name says how far it reaches (Direction D).
  const phone = useIsPhone();
  // Without search.use the icon is gone on a desk and on a phone (the shortcut and the route are gone too).
  const allowed = useRight(SEARCH_ITEM.right!, undefined, true);
  if (!allowed) return null;
  return (
    <Link
      to={SEARCH_ITEM.to}
      aria-label={phone ? t('phoneShell.searchAll') : t(SEARCH_ITEM.key)}
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
  const startReads = usePressReads();
  // The link's name carries the count: an aria-label replaces the hidden count inside it (audit 2026-10-03, BRW-10).
  const name = unread > 0 ? t('nav.withBadge', { name: t(item.key), badge: t('nav.inboxUnread', { count: unread }) }) : t(item.key);
  return (
    <Link
      to={item.to}
      onPointerDown={() => startReads(item.to)}
      aria-label={name}
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
  const startReads = usePressReads();
  const name = noticeBadge > 0
    ? t('nav.withBadge', { name: t(NOTIFICATIONS_ITEM.key), badge: t('nav.inboxBadge', { count: noticeBadge }) })
    : t(NOTIFICATIONS_ITEM.key);
  return (
    <Link
      to={NOTIFICATIONS_ITEM.to}
      onPointerDown={() => startReads(NOTIFICATIONS_ITEM.to)}
      aria-label={name}
      aria-current={on ? 'page' : undefined}
      className={`pressable relative grid size-11 shrink-0 place-items-center rounded-full ${on ? 'bg-fill text-ink' : 'text-ink-2 hover:text-ink'} ${className}`}
    >
      <AnimatedIcon icon={BellTab} size={20} playWhen={on} aria-hidden />
      {noticeBadge > 0 && <Badge count={noticeBadge} label={t('nav.inboxBadge', { count: noticeBadge })} className="absolute -top-1 -end-1" />}
    </Link>
  );
}
