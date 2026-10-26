import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { SettingsIcon } from '../components/icons/animated/settings';
import { LogoutIcon } from '../features/auth/LogoutIcon';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PersonFace } from '../components/PersonFace';
import { Popover } from '../components/Popover';
import { SegmentedControl } from '../components/SegmentedControl';
import { Switch } from '../components/Switch';
import { actorContext } from '../lib/grammar';
import { useMyState } from './live/hooks';
import { readEnvironment, resolveAppearance } from './appearance';
import { PreviewAs } from './PreviewAs';
import { PROTOTYPE, REMOTE } from './mode';
import { useSwitchLanguage } from './languageTurn';
import { usePersonName } from './personName';
import { useAction, useCall, useRuntime } from './runtime';
import { ShieldCheckIcon } from '../components/icons/animated/shield-check';
import { MessageSquarePlusIcon } from '../components/icons/animated/message-square-plus';
import { useSignOut } from '../features/auth/signOut';
import { useFeedbackSheet } from '../features/feedback/useFeedbackSheet';
import { SparklesIcon } from '../components/icons/animated/sparkles';
import { WHATS_NEW } from '../whatsNew/entries';
import { hasNew, readSeen } from '../whatsNew/seen';
import { opensAdminPage } from '../api/rights';
import { can } from '../api/permissions';

/**
 * One quick choice of the person menu: the label at the start and its control at the end. The control keeps its width, so a row
 * never wraps (fbk_063, owner 2026-10-26).
 */
function QuickRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-quick-row className="flex min-h-11 items-center justify-between gap-4 px-2">
      <span className="min-w-0 text-body text-ink">{label}</span>
      <div className="flex shrink-0">{children}</div>
    </div>
  );
}

/** A group of the person menu. A hairline separates it from the one above, and from the header for the first group. */
const GROUP = 'flex flex-col border-t border-hairline pt-1 mt-1';

/**
 * The person's picture opens their name and the menu in two groups (fbk_063, owner 2026-10-26). Group 1 holds the three quick choices:
 * Away, Mode (light or dark) and Language, each a label with its control. Group 2 holds the places: Admin, Settings, What's new and the
 * feedback sheet. The prototype adds Preview as under the header; the real build adds Sign out alone at the end (plan 5.1).
 */
export function PersonMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const session = useCall('session.get', {}).data;
  const user = session?.user;
  // The Admin page opens to a person with a right that opens a section (Management by default, fbk_014).
  const admin = session !== undefined && opensAdminPage(session.authority);
  // The item "Request a feature or report a bug" needs feedback.send (role rights version 2).
  const mayReport = session !== undefined && can(session.authority, 'feedback.send');
  const switchLanguage = useSwitchLanguage();
  const preferences = useAction('me.updatePreferences');
  const { live } = useRuntime();
  const myState = useMyState();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The feedback sheet loads in its own chunk (FL-4): it mounts at the first open and stays, so its closing animation stays.
  const feedback = useFeedbackSheet();
  const signOut = useSignOut();
  if (!user) return null;
  const close = () => {
    setOpen(false);
    ref.current?.focus();
  };
  const language = user.preferences.language === 'ar' ? 'ar' : 'en';
  // The checked part of Mode is the theme that shows now. Settings keeps the third choice, System.
  const theme = resolveAppearance(user.preferences, readEnvironment()).theme === 'dark' ? 'dark' : 'light';
  // A button centres its text by default. text-start keeps a label on two lines next to its icon (audit 2026-10-03, F-6).
  const row = 'pressable flex min-h-11 items-center gap-3 rounded-xl px-2 text-start text-body text-ink hover:bg-fill';
  return (
    <>
      <button ref={ref} type="button" aria-label={nameOf(user)} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="pressable grid size-11 place-items-center rounded-full">
        <PersonFace user={user} size={36} mine />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} label={nameOf(user)} onClose={close}>
          <div className="flex items-center gap-3">
            <PersonFace user={user} size={40} mine />
            <span className="min-w-0">
              <span className="block truncate text-headline text-ink">{nameOf(user)}</span>
              {/* With a live port the line under the name is the own state, as others see it (chat presence design A2 and A6). */}
              <span className="block truncate text-footnote text-ink-2">
                {live ? t(user.preferences.awayByHand ? 'presence.awayByYou' : `presence.${myState}`, { context: actorContext(user) }) : user.email}
              </span>
            </span>
          </div>
          {PROTOTYPE && <PreviewAs id={`preview-as-${id}`} />}
          {/* min-w-72 keeps the two choices with their labels on one line each, in English and in Arabic. */}
          <nav aria-label={nameOf(user)} className="-mx-2 flex min-w-72 flex-col">
            <div data-menu-group="quick" className={GROUP}>
              {live && (
                <div className="px-2">
                  <Switch
                    id="away-by-hand"
                    label={t('presence.showAway', { context: actorContext(user) })}
                    checked={user.preferences.awayByHand === true}
                    onChange={(next) => preferences.mutate({ awayByHand: next })}
                  />
                </div>
              )}
              <QuickRow label={t('personMenu.mode')}>
                <SegmentedControl
                  label={t('personMenu.mode')}
                  value={theme}
                  options={[{ value: 'light', label: t('settings.themes.light') }, { value: 'dark', label: t('settings.themes.dark') }]}
                  onChange={(next) => { if (next !== theme) preferences.mutate({ theme: next }); }}
                />
              </QuickRow>
              <QuickRow label={t('settings.language')}>
                <SegmentedControl
                  label={t('settings.language')}
                  value={language}
                  options={[{ value: 'en', label: t('settings.languages.en') }, { value: 'ar', label: t('settings.languages.ar') }]}
                  // close() gives the focus back to the picture, as the other items do (audit 2026-10-03, F-3).
                  onChange={(next) => { if (next !== language) { close(); switchLanguage(next); } }}
                />
              </QuickRow>
            </div>
            <div data-menu-group="places" className={GROUP}>
              {admin && (
                <Link to="/admin" onClick={close} className={row}>
                  <AnimatedIcon icon={ShieldCheckIcon} size={18} className="text-ink-2" aria-hidden />
                  {session?.authority.systemRole === 'admin' ? t('nav.admin') : t('adminPage.officeTitle')}
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
              {mayReport && (
                <button type="button" onClick={() => { close(); feedback.open(); }} className={row}>
                  <AnimatedIcon icon={MessageSquarePlusIcon} size={18} className="text-ink-2" aria-hidden />
                  {t('feedback.menu')}
                </button>
              )}
            </div>
            {REMOTE && (
              <div data-menu-group="signout" className={GROUP}>
                <button type="button" onClick={() => { setOpen(false); void signOut(); }} className={row}>
                  <AnimatedIcon icon={LogoutIcon} size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
                  {t('auth.signOut')}
                </button>
              </div>
            )}
          </nav>
        </Popover>
      )}
      {feedback.sheet}
    </>
  );
}
