import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { LanguagesIcon } from '../components/icons/animated/languages';
import { MoonIcon } from '../components/icons/animated/moon';
import { SettingsIcon } from '../components/icons/animated/settings';
import { SunIcon } from '../components/icons/animated/sun';
import { LogoutIcon } from '../features/auth/LogoutIcon';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Popover } from '../components/Popover';
import { readEnvironment, resolveAppearance } from './appearance';
import { PreviewAs } from './PreviewAs';
import { PROTOTYPE, REMOTE } from './mode';
import { useSwitchLanguage } from './languageTurn';
import { usePersonName } from './personName';
import { useAction, useCall } from './runtime';
import { ShieldCheckIcon } from '../components/icons/animated/shield-check';
import { MessageSquarePlusIcon } from '../components/icons/animated/message-square-plus';
import { FeedbackSheet } from '../features/feedback/FeedbackSheet';
import { useSignOut } from '../features/auth/signOut';
import { SparklesIcon } from '../components/icons/animated/sparkles';
import { WHATS_NEW } from '../whatsNew/entries';
import { hasNew, readSeen } from '../whatsNew/seen';
import { opensAdminPage } from '../api/rights';

/**
 * The person's picture opens their name, the language, light or dark mode and Settings (redesign spec 2.5). The prototype adds
 * Preview as; the real build adds Sign out at the end (plan 5.1).
 */
export function PersonMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const session = useCall('session.get', {}).data;
  const user = session?.user;
  // The Admin page opens to a person with a right that opens a section (Management by default, fbk_014).
  const admin = session !== undefined && opensAdminPage(session.authority);
  const switchLanguage = useSwitchLanguage();
  const preferences = useAction('me.updatePreferences');
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const signOut = useSignOut();
  if (!user) return null;
  const close = () => {
    setOpen(false);
    ref.current?.focus();
  };
  const nextLanguage = user.preferences.language === 'ar' ? 'en' : 'ar';
  // One press switches between light and dark. Settings keeps the third choice, System.
  const dark = resolveAppearance(user.preferences, readEnvironment()).theme === 'dark';
  const ThemeIcon = dark ? SunIcon : MoonIcon;
  // A button centres its text by default. text-start keeps a label on two lines next to its icon (audit 2026-10-03, F-6).
  const row = 'pressable flex min-h-11 items-center gap-3 rounded-xl px-2 text-start text-body text-ink hover:bg-fill';
  return (
    <>
      <button ref={ref} type="button" aria-label={nameOf(user)} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="pressable grid size-11 place-items-center rounded-full">
        <Avatar user={user} size={36} />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} label={nameOf(user)} onClose={close}>
          <div className="flex items-center gap-3">
            <Avatar user={user} size={40} />
            <span className="min-w-0">
              <span className="block truncate text-headline text-ink">{nameOf(user)}</span>
              <span className="block truncate text-footnote text-ink-2">{user.email}</span>
            </span>
          </div>
          {PROTOTYPE && <PreviewAs id={`preview-as-${id}`} />}
          <nav aria-label={nameOf(user)} className="-mx-2 flex flex-col">
            {/* close() gives the focus back to the picture, as the other items do (audit 2026-10-03, F-3). */}
            <button type="button" onClick={() => { close(); switchLanguage(nextLanguage); }} className={row}>
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
            {/* The small word New follows the item until the person sees the newest What's new entry (fbk_018; UX audit 2026-10-19, chats-16).
                The page marks the entry seen when the person opens it. */}
            <Link to="/whats-new" onClick={close} className={row}>
              <AnimatedIcon icon={SparklesIcon} size={18} className="text-ink-2" aria-hidden />
              {t('whatsNew.menu')}
              {hasNew(WHATS_NEW, readSeen(user.id)) && <span className="ms-auto text-footnote text-ink-2">{t('whatsNew.newMark')}</span>}
            </Link>
            {/* The focus goes back to the picture first, so the sheet gives it back there when it closes (audit 2026-10-03, SHL-19). */}
            <button type="button" onClick={() => { close(); setFeedback(true); }} className={row}>
              <AnimatedIcon icon={MessageSquarePlusIcon} size={18} className="text-ink-2" aria-hidden />
              {t('feedback.menu')}
            </button>
            {REMOTE && (
              <button type="button" onClick={() => { setOpen(false); void signOut(); }} className={row}>
                <AnimatedIcon icon={LogoutIcon} size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
                {t('auth.signOut')}
              </button>
            )}
          </nav>
        </Popover>
      )}
      <FeedbackSheet open={feedback} onOpenChange={setFeedback} />
    </>
  );
}
