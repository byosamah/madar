import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useDraftOwner, useDraftSweep } from './drafts';
import { useFocusLink } from '../features/focus/focusLink';
import { useOnceOn } from './lazyOverlay';
import { REMOTE } from './mode';
import { LazyFocusMode } from './overlays';
import { HomeMark } from './HomeMark';
import { PersonMenu } from './PersonMenu';
import { PhoneTopRow } from './PhoneTopRow';
import { screenKey, tabIndexOf } from './phoneShell';
import { useIsPhone } from './useIsPhone';
import { PicturesProvider } from './pictures';
import { SubCompaniesProvider } from './subCompanies';
import { PushSync } from './remote/PushSync';
import { StorageBanner } from './StorageBanner';
import { useRight } from './useRight';
import { usePhoneBarHide } from './usePhoneBarHide';
import { TabPill } from './TabPill';

/** The calm shell (redesign spec 2.5): a floating pill of four tabs and the person's picture. No sidebar and no toolbar. */
// Screens already shown in this visit. A screen's panels rise in only the first time (redesign spec 4).
const seen = new Set<string>();
// The tab of the last screen, so the next screen slides in from the side of the tab that was pressed.
let lastTab = -1;
const PROJECT_PAGE = /^\/projects\/[^/]+$/;

/**
 * The first panels of a screen rise 10 px and fade in, 60 ms apart, once per visit.
 * A change of tab slides the new screen in from the side of its tab, the same way the tab bar's highlight moves (owner, 2026-10-01).
 * A project page has its own entrance: the tapped row grows into its header (moment 1).
 */
function ScreenEntrance({ screen }: { screen: string }) {
  const { pathname } = useLocation();
  const phone = useIsPhone();
  const [first] = useState(() => !seen.has(pathname) && !PROJECT_PAGE.test(pathname));
  const [offset] = useState(() => {
    const tab = tabIndexOf(pathname, phone);
    if (tab < 0 || lastTab < 0 || tab === lastTab) return 0;
    const rtl = document.documentElement.dir === 'rtl';
    return Math.sign(tab - lastTab) * (rtl ? -48 : 48);
  });
  useEffect(() => {
    seen.add(pathname);
    const tab = tabIndexOf(pathname, phone);
    if (tab >= 0) lastTab = tab;
  }, [pathname, phone]);
  return (
    <motion.div
      data-screen={screen}
      className={first ? 'screen-enter' : undefined}
      initial={offset ? { opacity: 0, x: offset } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.42 }}
    >
      <Outlet />
    </motion.div>
  );
}

/**
 * A number that goes up each time another person becomes current (Preview as, or Reset sample data while a preview is on, in the
 * prototype; a sign-in as another person in the same tab, in the real build).
 * The first load of the session does not count, so the screen does not start again as the app opens.
 */
function usePersonTurn(): number {
  const owner = useDraftOwner();
  const [turn, setTurn] = useState({ owner, count: 0 });
  if (owner && owner !== turn.owner) setTurn({ owner, count: turn.owner ? turn.count + 1 : turn.count });
  return turn.count;
}

/**
 * The app frame. It reads the profile pictures of the office once, for every Avatar inside (owner item 10, 2026-10-05), and the
 * sub-companies with their logos (fbk_007).
 */
export function AppShell() {
  return <PicturesProvider><SubCompaniesProvider><Shell /></SubCompaniesProvider></PicturesProvider>;
}

/**
 * Focus mode loads in its own chunk (performance audit 2026-10-21, FL-4). It mounts at the first ?focus= and stays mounted, so its
 * closing animation stays. Without a task in focus it renders nothing, so the chunk costs a session without Focus mode nothing.
 */
function FocusSlot() {
  const { taskId } = useFocusLink();
  return useOnceOn(taskId !== null) ? <LazyFocusMode /> : null;
}

function Shell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const phone = useIsPhone();
  const key = screenKey(pathname, phone);
  // A change of person drops the half-written words of the person before (audit 2026-10-03, V-22).
  useDraftSweep();
  // A change of person also starts the open screen again, so no box on it keeps the unsent words or picked files of the
  // person before, for example the project update box (audit 2026-10-03, V-22).
  const personTurn = usePersonTurn();
  // While the phone bar hides (an open chat, the keyboard, Focus mode), the page gives up the bar space (--phone-bar is 0 px).
  // The layout effect sets the mark before the first paint, so a push that opens a chat shows no bar space.
  const barHidden = usePhoneBarHide() !== null;
  useLayoutEffect(() => {
    if (!barHidden) return undefined;
    document.documentElement.dataset.barHidden = '';
    return () => { delete document.documentElement.dataset.barHidden; };
  }, [barHidden]);

  // Without search.use the shortcut does nothing (role rights version 2). Before the session arrives it works, as the icon shows.
  const mayFind = useRight('search.use', undefined, true);
  useEffect(() => {
    if (!mayFind) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, mayFind]);

  return (
    <div className="min-h-dvh text-ink">
      <StorageBanner />
      {/* Browser push (owner, 2026-10-08): saves the endpoint of this browser again when the server does not list it. No screen. */}
      {REMOTE && <PushSync />}
      <TabPill />
      <FocusSlot />
      <div className="fixed start-4 top-4 z-30 hidden sm:block">
        <HomeMark />
      </div>
      <div className="fixed end-4 top-4 z-30 hidden sm:block">
        <PersonMenu id="wide" />
      </div>
      <main className="app-page relative mx-auto w-full max-w-6xl px-4 pt-[max(1rem,env(safe-area-inset-top))] max-sm:pb-[calc(var(--phone-bar)+1.5rem)] sm:px-8 sm:pb-16 sm:pt-24">
        {/* On a phone the tab bar keeps only the tabs. The top row holds the mark (or a back link) and Search. */}
        <PhoneTopRow />
        <ScreenEntrance key={`${personTurn}:${key}`} screen={key} />
        {/* Each screen keeps its own scroll place; a new screen opens at the top. Changes to the link's values keep the place. */}
        <ScrollRestoration getKey={(location) => location.pathname} />
      </main>
    </div>
  );
}
