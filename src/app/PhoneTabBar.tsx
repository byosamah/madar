import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { TFunction } from 'i18next';
import type { MouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Badge } from '../components/Badge';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { fade, spring } from '../design/motion';
import { subscribeWorkView, workTabLink } from './lastList';
import { PHONE_NAV, phoneTabOf } from './nav';
import { usePressReads } from './pressReads';
import { useCall } from './runtime';
import { useCompactBars } from './useCompactBars';
import { usePhoneBarHide } from './usePhoneBarHide';

/**
 * The name of the Inbox link. The Inbox tab counts the unread chats and the items that need action in the bell. Its count badge
 * shows their sum, so the link names both counts in words. No count gives the plain word.
 */
export function inboxName(t: TFunction, unread: number, notices: number): string {
  const name = t('phoneShell.tab.inbox');
  const chats = t('nav.inboxUnread', { count: unread });
  const items = t('nav.inboxBadge', { count: notices });
  if (unread > 0 && notices > 0) return t('phoneShell.inboxBoth', { name, chats, notices: items });
  if (unread > 0) return t('nav.withBadge', { name, badge: chats });
  if (notices > 0) return t('nav.withBadge', { name, badge: items });
  return name;
}

/**
 * The bar of a phone (Direction D): four tabs, Today, Inbox, Work and Me. Each tab shows only its icon, and its word stays for
 * screen readers (owner, 2026-10-22). The open tab carries the navy pill. A press on the open tab scrolls the page to the top.
 * The bar keeps `data-pill`, so Focus mode makes it inert.
 */
export function PhoneTabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const unread = useCall('chats.unreadCount', {}).data?.unread ?? 0;
  const notices = useCall('notifications.count', {}).data?.badge ?? 0;
  const compact = useCompactBars();
  const startReads = usePressReads();
  const workLink = useSyncExternalStore(subscribeWorkView, workTabLink, () => '/work');
  const open = phoneTabOf(pathname);
  const hide = usePhoneBarHide();
  const reduced = useReducedMotion();
  // In a chat the bar leaves the page and slides back on Back. With the keyboard open it stays mounted, clear and inert. The
  // scale of the compact bar transitions through the CSS scale property, so it does not fight the slide of the motion.
  const keyboard = hide === 'keyboard';
  return (
    <AnimatePresence initial={false}>
      {hide !== 'route' && (
    <motion.nav
      key="bar"
      aria-label={t('nav.main')}
      data-pill
      data-compact={compact || undefined}
      inert={keyboard}
      initial={reduced ? { opacity: 0 } : { y: '100%', opacity: 0 }}
      animate={{ opacity: keyboard ? 0 : 1, ...(reduced ? {} : { y: 0 }) }}
      exit={reduced ? { opacity: 0, transition: fade } : { y: '100%', opacity: 0, transition: spring.standard }}
      transition={keyboard ? { duration: 0 } : reduced ? fade : spring.standard}
      className={`pill fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-[calc(100vw-32px)] max-w-md items-center gap-0.5 rounded-full p-1.5 origin-bottom motion-safe:transition-[scale] motion-safe:duration-300 ${compact ? 'motion-safe:scale-[0.94]' : ''} ${keyboard ? 'pointer-events-none opacity-0' : ''}`}
    >
      {PHONE_NAV.map((item) => {
        const to = item.tab === 'work' ? workLink : item.to;
        const active = open === item.tab;
        const Moving = item.animated;
        const total = unread + notices;
        const name = item.tab === 'inbox' ? inboxName(t, unread, notices) : undefined;
        const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
          // A press on the lit tab, at its own address, goes to the top. A lit tab whose link points elsewhere navigates.
          if (pathname !== to.split('?')[0]) return;
          event.preventDefault();
          // The device setting is read at the press, so a change of it counts at once.
          const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        };
        return (
          <Link
            key={item.tab}
            to={to}
            onPointerDown={() => startReads(to.split('?')[0])}
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            aria-label={item.tab === 'inbox' && total > 0 ? name : undefined}
            className={`pressable relative isolate flex h-12 min-w-0 flex-1 items-center justify-center rounded-full ${active ? 'text-[var(--on-sig)]' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && <motion.span layoutId="pill-active" transition={spring.standard} className="signature absolute inset-0 -z-10 rounded-full" />}
            {/* A block icon: an inline one sits on the text line, and the room under that line lifts it about 2 px above the middle. */}
            <span data-tab-icon className="relative grid place-items-center [&_svg]:block">
              <AnimatedIcon icon={Moving} size={24} playWhen={active} aria-hidden />
              {item.tab === 'inbox' && total > 0 && <Badge count={total} label={name ?? ''} className="absolute -top-2 -end-3" />}
            </span>
            <span data-tab-word className="sr-only">{t(item.key)}</span>
          </Link>
        );
      })}
    </motion.nav>
      )}
    </AnimatePresence>
  );
}
