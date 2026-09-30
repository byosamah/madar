import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Languages, PanelLeft, Rows3 } from 'lucide-react';
import { NAV, isNavActive } from './nav';
import { PreviewAs } from './PreviewAs';
import { useAction, useCall } from './runtime';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';

export function Sidebar({ compact, onHide, onUseTabBar }: { compact: boolean; onHide?: () => void; onUseTabBar?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useCall('session.get', {}).data?.user;
  const badge = useCall('notifications.count', {}).data?.badge ?? 0;
  const setPreferences = useAction('me.updatePreferences');
  const nextLanguage = user?.preferences.language === 'ar' ? 'en' : 'ar';
  const iconButton = 'pressable grid size-11 place-items-center rounded-full text-label-2 hover:bg-fill';

  return (
    <nav aria-label={t('nav.main')} className={`glass flex h-full flex-col gap-1 rounded-card p-2 ${compact ? 'w-16 items-center' : 'w-64'}`}>
      <div className={`flex items-center pb-2 ${compact ? 'justify-center' : 'justify-between ps-2'}`}>
        {!compact && <span className="text-title-3">{t('app.name')}</span>}
        {onHide && (
          <button type="button" onClick={onHide} aria-label={t('nav.hideSidebar')} className={iconButton}>
            <PanelLeft size={20} className="rtl:-scale-x-100" aria-hidden />
          </button>
        )}
        {onUseTabBar && (
          <button type="button" onClick={onUseTabBar} aria-label={t('nav.useTabBar')} className={iconButton}>
            <Rows3 size={20} aria-hidden />
          </button>
        )}
      </div>
      {NAV.map((item) => {
        const active = isNavActive(item.to, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-label={compact ? t(item.key) : undefined}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative flex min-h-11 items-center gap-3 rounded-xl ${compact ? 'w-11 justify-center' : 'w-full px-3'} ${active ? 'bg-fill-strong text-label' : 'text-label-2 hover:bg-fill'}`}
          >
            <Icon size={20} className={active ? 'text-accent' : ''} aria-hidden />
            {!compact && <span className="text-body font-medium">{t(item.key)}</span>}
            {item.badge && badge > 0 && (
              <Badge count={badge} label={t('nav.inboxBadge', { count: badge })} className={compact ? 'absolute -top-1 end-0' : 'ms-auto'} />
            )}
          </Link>
        );
      })}
      <div className={`mt-auto flex flex-col gap-2 pt-2 ${compact ? 'items-center' : 'w-full px-1'}`}>
        {!compact && <PreviewAs id="preview-as-sidebar" />}
        <button
          type="button"
          onClick={() => setPreferences.mutate({ language: nextLanguage })}
          aria-label={t(`settings.languages.${nextLanguage}`)}
          className={`pressable flex min-h-11 items-center gap-2 rounded-xl text-subheadline text-label-2 hover:bg-fill ${compact ? 'w-11 justify-center' : 'px-2'}`}
        >
          <Languages size={18} aria-hidden />
          {!compact && <span aria-hidden>{t(`settings.languages.${nextLanguage}`)}</span>}
        </button>
        {user && (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label={t('nav.settings')}
            className={`pressable flex min-h-11 items-center gap-2 rounded-xl hover:bg-fill ${compact ? 'w-11 justify-center' : 'px-2'}`}
          >
            <Avatar user={user} size={28} />
            {!compact && <span aria-hidden className="truncate text-subheadline">{user.name}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
