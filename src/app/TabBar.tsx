import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { NAV, SEARCH_ITEM, isNavActive } from './nav';
import { useCall } from './runtime';
import { Badge } from '../components/Badge';

/** Navigation only, never actions. It stays visible, except under a sheet (spec 3.2). */
export function TabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const badge = useCall('notifications.count', {}).data?.badge ?? 0;
  return (
    <nav
      aria-label={t('nav.tabs')}
      className="glass fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-full px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1"
    >
      {[...NAV, SEARCH_ITEM].map((item) => {
        const active = isNavActive(item.to, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1 ${active ? 'text-glass-accent' : 'text-label-2'}`}
          >
            <Icon size={22} aria-hidden />
            <span className="whitespace-nowrap text-caption font-medium">{t(item.tabKey ?? item.key)}</span>
            {item.badge && badge > 0 && <Badge count={badge} label={t('nav.inboxBadge', { count: badge })} className="absolute top-0 end-[18%]" />}
          </Link>
        );
      })}
    </nav>
  );
}
