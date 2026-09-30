import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PanelLeft, Search, SquareMenu } from 'lucide-react';
import { useCall } from './runtime';
import { useCompactBars } from './useCompactBars';
import { Avatar } from '../components/Avatar';

export function Toolbar({ onShowSidebar, onUseSidebar }: { onShowSidebar?: () => void; onUseSidebar?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useCall('session.get', {}).data?.user;
  const compact = useCompactBars();
  const iconButton = 'pressable size-11 place-items-center rounded-full text-label-2 hover:bg-fill';
  return (
    <header data-compact={compact || undefined} className={`glass toolbar-fade sticky top-0 z-20 flex min-h-14 items-center gap-2 px-4 pt-[env(safe-area-inset-top)] transition-transform duration-300 ${compact ? '-translate-y-1' : ''}`}>
      {onShowSidebar && (
        <button type="button" onClick={onShowSidebar} aria-label={t('nav.showSidebar')} className={`${iconButton} hidden lg:grid`}>
          <PanelLeft size={20} className="rtl:-scale-x-100" aria-hidden />
        </button>
      )}
      {onUseSidebar && (
        <button type="button" onClick={onUseSidebar} aria-label={t('nav.useSidebar')} className={`${iconButton} hidden sm:max-lg:grid`}>
          <SquareMenu size={20} aria-hidden />
        </button>
      )}
      <span className="text-headline sm:hidden">{t('app.name')}</span>
      <div className="ms-auto flex items-center gap-1">
        <button type="button" onClick={() => navigate('/search')} aria-label={t('nav.search')} className={`${iconButton} hidden sm:grid`}>
          <Search size={20} aria-hidden />
        </button>
        {user && (
          <button type="button" onClick={() => navigate('/settings')} aria-label={t('nav.settings')} className="pressable grid size-11 place-items-center rounded-full lg:hidden">
            <Avatar user={user} size={30} />
          </button>
        )}
      </div>
    </header>
  );
}
