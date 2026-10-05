import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useDraftOwner, useDraftSweep } from './drafts';
import { projectsListLink } from './lastList';
import { FocusMode } from '../features/focus/FocusMode';
import { NAV, isNavActive } from './nav';
import { PersonMenu } from './PersonMenu';
import { PicturesProvider } from './pictures';
import { StorageBanner } from './StorageBanner';
import { BellButton, SearchButton, TabPill } from './TabPill';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../components/icons/animated/chevron-left';
import { MadarMark } from '../components/MadarMark';

/** The calm shell (redesign spec 2.5): a floating pill of four tabs and the person's picture. No sidebar and no toolbar. */
// Screens already shown in this visit. A screen's panels rise in only the first time (redesign spec 4).
const seen = new Set<string>();
// The tab of the last screen, so the next screen slides in from the side of the tab that was pressed.
let lastTab = -1;
const PROJECT_PAGE = /^\/projects\/[^/]+$/;
const tabOf = (pathname: string) => (PROJECT_PAGE.test(pathname) ? -1 : NAV.findIndex((item) => isNavActive(item.to, pathname)));

/**
 * The first panels of a screen rise 10 px and fade in, 60 ms apart, once per visit.
 * A change of tab slides the new screen in from the side of its tab, the same way the tab bar's highlight moves (owner, 2026-10-01).
 * A project page has its own entrance: the tapped row grows into its header (moment 1).
 */
function ScreenEntrance() {
  const { pathname } = useLocation();
  const [first] = useState(() => !seen.has(pathname) && !PROJECT_PAGE.test(pathname));
  const [offset] = useState(() => {
    const tab = tabOf(pathname);
    if (tab < 0 || lastTab < 0 || tab === lastTab) return 0;
    const rtl = document.documentElement.dir === 'rtl';
    return Math.sign(tab - lastTab) * (rtl ? -48 : 48);
  });
  useEffect(() => {
    seen.add(pathname);
    const tab = tabOf(pathname);
    if (tab >= 0) lastTab = tab;
  }, [pathname]);
  return (
    <motion.div
      className={first ? 'screen-enter' : undefined}
      initial={offset ? { opacity: 0, x: offset } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.42 }}
    >
      <Outlet />
    </motion.div>
  );
}

/** The Madar mark at the top start of the screen (owner, 2026-10-04). A press opens Home, as on most sites. */
function HomeMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link to="/" aria-label={t('nav.madarHome')} className={`pressable grid size-11 place-items-center rounded-[14px] ${className ?? ''}`}>
      <MadarMark size={36} />
    </Link>
  );
}

/** The chat is one screen: opening another conversation keeps the list, its search and its place. */
const screenKey = (pathname: string): string => (pathname.startsWith('/inbox/') ? '/inbox' : pathname);

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

/** The app frame. It reads the profile pictures of the office once, for every Avatar inside (owner item 10, 2026-10-05). */
export function AppShell() {
  return <PicturesProvider><Shell /></PicturesProvider>;
}

function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // A change of person drops the half-written words of the person before (audit 2026-10-03, V-22).
  useDraftSweep();
  // A change of person also starts the open screen again, so no box on it keeps the unsent words or picked files of the
  // person before, for example the project update box (audit 2026-10-03, V-22).
  const personTurn = usePersonTurn();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="min-h-dvh text-ink">
      <StorageBanner />
      <TabPill />
      <FocusMode />
      <div className="fixed start-4 top-4 z-30 hidden sm:block">
        <HomeMark />
      </div>
      <div className="fixed end-4 top-4 z-30 hidden sm:block">
        <PersonMenu id="wide" />
      </div>
      <main className="app-page relative mx-auto w-full max-w-6xl px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pb-16 sm:pt-24">
        {/* On a phone the tab bar keeps only the tabs; the mark (or the back link of a project page), Search, the bell and the picture sit at the top. */}
        <div className="-me-1.5 flex items-center justify-end gap-0.5 pb-1 sm:hidden">
          {!PROJECT_PAGE.test(pathname) && <HomeMark className="-ms-1 me-auto" />}
          {PROJECT_PAGE.test(pathname) && (
            <Link to={projectsListLink()} className="pressable -ms-2 me-auto inline-flex min-h-11 items-center gap-0.5 rounded-full pe-3 ps-1 text-subheadline font-semibold text-link">
              <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
              {t('project.back')}
            </Link>
          )}
          <SearchButton />
          <BellButton />
          <PersonMenu id="phone" />
        </div>
        <ScreenEntrance key={`${personTurn}:${screenKey(pathname)}`} />
        {/* Each screen keeps its own scroll place; a new screen opens at the top. Changes to the link's values keep the place. */}
        <ScrollRestoration getKey={(location) => location.pathname} />
      </main>
    </div>
  );
}
