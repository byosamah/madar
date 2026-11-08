import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { SettingsIcon } from '../components/icons/animated/settings';
import { LogoutIcon } from '../features/auth/LogoutIcon';
import { PersonFace } from '../components/PersonFace';
import { Popover } from '../components/Popover';
import { SwitchButton } from '../components/Switch';
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
import { SparklesIcon } from '../components/icons/animated/sparkles';
import { WHATS_NEW } from '../whatsNew/entries';
import { hasNew, readSeen } from '../whatsNew/seen';
import { opensAdminPage } from '../api/rights';
import { can } from '../api/permissions';

/**
 * One quick choice of the person menu: the label at the start and its control at the end, in a box of one width, so the three controls end on
 * one edge and keep one height (31 px). The row is 44 px high (owner, 2026-10-26: "no spaces, no alignments, something off").
 */
function QuickRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const text = 'min-w-0 text-body text-ink';
  return (
    <div data-quick-row className="flex min-h-11 items-center justify-between gap-4 px-2">
      {htmlFor ? <label htmlFor={htmlFor} className={text}>{label}</label> : <span className={text}>{label}</span>}
      <div className="flex w-24 shrink-0 justify-end">{children}</div>
    </div>
  );
}

/** The one button of Mode and of Language: it names the other choice, and a press takes it (owner, 2026-10-26). */
const QUICK_BUTTON = 'pressable inline-flex h-[31px] w-24 items-center justify-center rounded-full bg-fill text-subheadline font-medium text-ink hover:bg-fill-strong';

/** A group of the person menu. A hairline separates it from the one above, and from the header for the first group. */
const GROUP = 'flex flex-col border-t border-hairline pt-1 mt-1';


export type PersonMenuPanelProps = {
  id: string;
  /** The round picture that the panel hangs from. */
  anchor: HTMLElement;
  /** Closes the panel and gives the focus back to the picture. */
  onClose: () => void;
  /** Closes the panel and leaves the focus where it is (Sign out). */
  onLeave: () => void;
  /** Opens the feedback sheet. The panel closes first. */
  onFeedback: () => void;
};

/**
 * The panel of the person menu: the header, Preview as (prototype), the two groups and Sign out. It is a chunk of its own: most
 * sessions never open the menu, so its controls stay out of the first load. `PersonMenu.tsx` loads it through `overlays.tsx`.
 * Never import this file statically from the shell. The panel holds the Popover, so nothing shows until the chunk is there.
 */
export function PersonMenuPanel({ id, anchor, onClose, onLeave, onFeedback }: PersonMenuPanelProps) {
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
  const signOut = useSignOut();
  if (!user) return null;
  const otherLanguage = user.preferences.language === 'ar' ? 'en' : 'ar';
  // The theme that shows now; the Mode button names the other one. Settings keeps the third choice, System.
  const theme = resolveAppearance(user.preferences, readEnvironment()).theme === 'dark' ? 'dark' : 'light';
  // A button centres its text by default. text-start keeps a label on two lines next to its icon (audit 2026-10-03, F-6).
  const row = 'pressable flex min-h-11 items-center gap-3 rounded-xl px-2 text-start text-body text-ink hover:bg-fill';
  return (
    <Popover anchor={anchor} label={nameOf(user)} onClose={onClose}>
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
      {/* min-w-72 keeps each label and its control on one line, in English and in Arabic. */}
      <nav aria-label={nameOf(user)} className="-mx-2 flex min-w-72 flex-col">
        <div data-menu-group="quick" className={GROUP}>
          {live && (
            <QuickRow label={t('presence.showAway', { context: actorContext(user) })} htmlFor="away-by-hand">
              <SwitchButton id="away-by-hand" checked={user.preferences.awayByHand === true} onChange={(next) => preferences.mutate({ awayByHand: next })} />
            </QuickRow>
          )}
          <QuickRow label={t('personMenu.mode')}>
            <button
              type="button"
              aria-label={t(theme === 'dark' ? 'nav.lightMode' : 'nav.darkMode')}
              onClick={() => preferences.mutate({ theme: theme === 'dark' ? 'light' : 'dark' })}
              className={QUICK_BUTTON}
            >
              {t(theme === 'dark' ? 'settings.themes.light' : 'settings.themes.dark')}
            </button>
          </QuickRow>
          <QuickRow label={t('settings.language')}>
            {/* onClose() gives the focus back to the picture, as the other items do (audit 2026-10-03, F-3). */}
            <button type="button" lang={otherLanguage} onClick={() => { onClose(); switchLanguage(otherLanguage); }} className={QUICK_BUTTON}>
              {t(`settings.languages.${otherLanguage}`)}
            </button>
          </QuickRow>
        </div>
        <div data-menu-group="places" className={GROUP}>
          {admin && (
            <Link to="/admin" onClick={onClose} className={row}>
              <AnimatedIcon icon={ShieldCheckIcon} size={18} className="text-ink-2" aria-hidden />
              {session?.authority.systemRole === 'admin' ? t('nav.admin') : t('adminPage.officeTitle')}
            </Link>
          )}
          <Link to="/settings" onClick={onClose} className={row}>
            <AnimatedIcon icon={SettingsIcon} size={18} className="text-ink-2" aria-hidden />
            {t('nav.settings')}
          </Link>
          {/* The small word New follows the item until the person sees the newest What's new entry (fbk_018; UX audit 2026-10-19, chats-16).
              The page marks the entry seen when the person opens it. */}
          <Link to="/whats-new" onClick={onClose} className={row}>
            <AnimatedIcon icon={SparklesIcon} size={18} className="text-ink-2" aria-hidden />
            {t('whatsNew.menu')}
            {hasNew(WHATS_NEW, readSeen(user.id)) && <span className="ms-auto text-footnote text-ink-2">{t('whatsNew.newMark')}</span>}
          </Link>
          {/* The focus goes back to the picture first, so the sheet gives it back there when it closes (audit 2026-10-03, SHL-19). */}
          {mayReport && (
            <button type="button" onClick={() => { onClose(); onFeedback(); }} className={row}>
              <AnimatedIcon icon={MessageSquarePlusIcon} size={18} className="text-ink-2" aria-hidden />
              {t('feedback.menu')}
            </button>
          )}
        </div>
        {REMOTE && (
          <div data-menu-group="signout" className={GROUP}>
            <button type="button" onClick={() => { onLeave(); void signOut(); }} className={row}>
              <AnimatedIcon icon={LogoutIcon} size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
              {t('auth.signOut')}
            </button>
          </div>
        )}
      </nav>
    </Popover>
  );
}
