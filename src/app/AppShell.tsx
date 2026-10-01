import { useEffect } from 'react';
import { Outlet, ScrollRestoration, useNavigate } from 'react-router';
import { FocusMode } from '../features/focus/FocusMode';
import { PersonMenu } from './PersonMenu';
import { StorageBanner } from './StorageBanner';
import { TabPill } from './TabPill';

/** The calm shell (redesign spec 2.5): a floating pill of four tabs and the person's picture. No sidebar and no toolbar. */
export function AppShell() {
  const navigate = useNavigate();

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
      <main className="app-page mx-auto w-full max-w-6xl px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pb-16 sm:pt-24">
        <div className="-me-1.5 flex justify-end sm:hidden">
          <PersonMenu id="phone" />
        </div>
        <Outlet />
        {/* Each screen keeps its own scroll place; a new screen opens at the top. Changes to the link's values keep the place. */}
        <ScrollRestoration getKey={(location) => location.pathname} />
      </main>
    </div>
  );
}
