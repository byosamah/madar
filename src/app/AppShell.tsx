import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useDraftSweep } from './drafts';
import { projectsListLink } from './lastList';
import { FocusMode } from '../features/focus/FocusMode';
import { NAV, isNavActive } from './nav';
import { PersonMenu } from './PersonMenu';
import { StorageBanner } from './StorageBanner';
import { BellButton, SearchButton, TabPill } from './TabPill';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../components/icons/animated/chevron-left';

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

/** The chat is one screen: opening another conversation keeps the list, its search and its place. */
const screenKey = (pathname: string): string => (pathname.startsWith('/inbox/') ? '/inbox' : pathname);

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // A change of person drops the half-written words of the person before (audit 2026-10-03, V-22).
  useDraftSweep();

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
      <div className="fixed end-4 top-4 z-30 hidden sm:block">
        <PersonMenu id="wide" />
      </div>
      <main className="app-page relative mx-auto w-full max-w-6xl px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pb-16 sm:pt-24">
        {/* On a phone the tab bar keeps only the tabs; Search, the bell and the picture sit at the top. */}
        <div className="-me-1.5 flex items-center justify-end gap-0.5 pb-1 sm:hidden">
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
        <ScreenEntrance key={screenKey(pathname)} />
        {/* Each screen keeps its own scroll place; a new screen opens at the top. Changes to the link's values keep the place. */}
        <ScrollRestoration getKey={(location) => location.pathname} />
      </main>
    </div>
  );
}
