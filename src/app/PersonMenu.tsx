import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { LanguagesIcon } from '../components/icons/animated/languages';
import { MoonIcon } from '../components/icons/animated/moon';
import { SettingsIcon } from '../components/icons/animated/settings';
import { SunIcon } from '../components/icons/animated/sun';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Popover } from '../components/Popover';
import { readEnvironment, resolveAppearance } from './appearance';
import { PreviewAs } from './PreviewAs';
import { useSwitchLanguage } from './languageTurn';
import { useAction, useCall } from './runtime';
import { ShieldCheckIcon } from '../components/icons/animated/shield-check';

/** The person's picture opens their name, Preview as (prototype), the language, light or dark mode and Settings (redesign spec 2.5). */
export function PersonMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {}).data;
  const user = session?.user;
  const admin = session?.authority.systemRole === 'admin';
  const switchLanguage = useSwitchLanguage();
  const preferences = useAction('me.updatePreferences');
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const close = () => {
    setOpen(false);
    ref.current?.focus();
  };
  const nextLanguage = user.preferences.language === 'ar' ? 'en' : 'ar';
  // One press switches between light and dark. Settings keeps the third choice, System.
  const dark = resolveAppearance(user.preferences, readEnvironment()).theme === 'dark';
  const ThemeIcon = dark ? SunIcon : MoonIcon;
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
            <button type="button" onClick={() => { setOpen(false); switchLanguage(nextLanguage); }} className={row}>
              <AnimatedIcon icon={LanguagesIcon} size={18} className="text-ink-2" aria-hidden />
              {t(`settings.languages.${nextLanguage}`)}
            </button>
            <button type="button" onClick={() => preferences.mutate({ theme: dark ? 'light' : 'dark' })} className={row}>
              <AnimatedIcon icon={ThemeIcon} size={18} className="text-ink-2" aria-hidden />
              {t(dark ? 'nav.lightMode' : 'nav.darkMode')}
            </button>
            {admin && (
              <Link to="/admin" onClick={close} className={row}>
                <AnimatedIcon icon={ShieldCheckIcon} size={18} className="text-ink-2" aria-hidden />
                {t('nav.admin')}
              </Link>
            )}
            <Link to="/settings" onClick={close} className={row}>
              <AnimatedIcon icon={SettingsIcon} size={18} className="text-ink-2" aria-hidden />
              {t('nav.settings')}
            </Link>
          </nav>
        </Popover>
      )}
    </>
  );
}
