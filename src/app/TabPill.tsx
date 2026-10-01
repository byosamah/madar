import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Badge } from '../components/Badge';
import { spring } from '../design/motion';
import { NAV, SEARCH_ITEM, isNavActive } from './nav';
import { useCall } from './runtime';
import { useCompactBars } from './useCompactBars';

/** The floating pill (redesign spec 2.5): top center from 640 px, bottom center on a phone. The open tab carries the signature. */
export function TabPill() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const badge = useCall('notifications.count', {}).data?.badge ?? 0;
  const compact = useCompactBars();
  const Search = SEARCH_ITEM.icon;
  return (
    <nav
      aria-label={t('nav.main')}
      data-pill
      data-compact={compact || undefined}
      className={`pill fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-max max-w-[calc(100vw-24px)] items-center gap-0.5 rounded-full p-1.5 origin-bottom motion-safe:transition-transform motion-safe:duration-300 sm:bottom-auto sm:top-4 sm:origin-top ${compact ? 'max-sm:motion-safe:scale-[0.94]' : ''}`}
    >
      {NAV.map((item) => {
        const active = isNavActive(item.to, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative isolate flex min-h-11 min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-full px-2 text-caption font-semibold sm:flex-row sm:px-4 sm:text-subheadline ${active ? 'text-[var(--on-sig)]' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && <motion.span layoutId="pill-active" transition={spring.standard} className="signature absolute inset-0 -z-10 rounded-full" />}
            <Icon size={20} className="sm:hidden" aria-hidden />
            <span className="whitespace-nowrap">{t(item.key)}</span>
            {item.badge && badge > 0 && <Badge count={badge} label={t('nav.inboxBadge', { count: badge })} className="absolute -top-0.5 end-1" />}
          </Link>
        );
      })}
      <Link
        to={SEARCH_ITEM.to}
        aria-label={t(SEARCH_ITEM.key)}
        aria-current={pathname === SEARCH_ITEM.to ? 'page' : undefined}
        className={`pressable grid size-11 shrink-0 place-items-center rounded-full ${pathname === SEARCH_ITEM.to ? 'bg-fill text-ink' : 'text-ink-2 hover:text-ink'}`}
      >
        <Search size={20} aria-hidden />
      </Link>
    </nav>
  );
}
