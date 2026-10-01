import { Clock, Languages, Settings } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Popover } from '../components/Popover';
import { PreviewAs } from './PreviewAs';
import { useAction, useCall } from './runtime';

/** The person's picture opens their name, Preview as (prototype), the language, My hours and Settings (redesign spec 2.5). */
export function PersonMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  const user = useCall('session.get', {}).data?.user;
  const setPreferences = useAction('me.updatePreferences');
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const close = () => setOpen(false);
  const nextLanguage = user.preferences.language === 'ar' ? 'en' : 'ar';
  const row = 'pressable flex min-h-11 items-center gap-3 rounded-xl px-2 text-body text-ink hover:bg-fill';
  return (
    <>
      <button ref={ref} type="button" aria-label={user.name} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="pressable grid size-11 place-items-center rounded-full">
        <Avatar user={user} size={36} />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} label={user.name} onClose={close}>
          <div className="flex items-center gap-3">
            <Avatar user={user} size={40} />
            <span className="min-w-0">
              <span className="block truncate text-headline text-ink">{user.name}</span>
              <span className="block truncate text-footnote text-ink-2">{user.email}</span>
            </span>
          </div>
          <PreviewAs id={`preview-as-${id}`} />
          <nav aria-label={user.name} className="-mx-2 flex flex-col">
            <button type="button" onClick={() => setPreferences.mutate({ language: nextLanguage })} className={row}>
              <Languages size={18} className="text-ink-2" aria-hidden />
              {t(`settings.languages.${nextLanguage}`)}
            </button>
            <Link to="/work?tab=hours" onClick={close} className={row}>
              <Clock size={18} className="text-ink-2" aria-hidden />
              {t('nav.myHours')}
            </Link>
            <Link to="/settings" onClick={close} className={row}>
              <Settings size={18} className="text-ink-2" aria-hidden />
              {t('nav.settings')}
            </Link>
          </nav>
        </Popover>
      )}
    </>
  );
}
