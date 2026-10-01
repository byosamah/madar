import { useEffect, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { FocusMode } from '../features/focus/FocusMode';
import { PersonMenu } from './PersonMenu';
import { StorageBanner } from './StorageBanner';
import { TabPill } from './TabPill';

/** The calm shell (redesign spec 2.5): a floating pill of four tabs and the person's picture. No sidebar and no toolbar. */
// Screens already shown in this visit. A screen's panels rise in only the first time (redesign spec 4).
const seen = new Set<string>();

/** The first panels of a screen rise 10 px and fade in, 60 ms apart, once per visit. */
function ScreenEntrance() {
  const { pathname } = useLocation();
  // A project page has its own entrance: the tapped row grows into its header (moment 1).
  const [first] = useState(() => !seen.has(pathname) && !/^\/projects\/[^/]+$/.test(pathname));
  useEffect(() => {
    seen.add(pathname);
  }, [pathname]);
  return (
    <div className={first ? 'screen-enter' : undefined}>
      <Outlet />
    </div>
  );
}

/** The chat is one screen: opening another conversation keeps the list, its search and its place. */
const screenKey = (pathname: string): string => (pathname.startsWith('/inbox/') ? '/inbox' : pathname);

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

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
        <div className="absolute end-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 sm:hidden">
          <PersonMenu id="phone" />
        </div>
        <ScreenEntrance key={screenKey(pathname)} />
        {/* Each screen keeps its own scroll place; a new screen opens at the top. Changes to the link's values keep the place. */}
        <ScrollRestoration getKey={(location) => location.pathname} />
      </main>
    </div>
  );
}
