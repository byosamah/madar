import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { StorageBanner } from './StorageBanner';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';

const SIDEBAR_HIDDEN = 'madar.sidebarHidden';
const TABLET_TABS = 'madar.tabletTabs';

// Per-viewer layout choices only. The app works the same when storage is blocked.
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage is blocked. The choice lasts for this visit only.
  }
}

export function AppShell() {
  const navigate = useNavigate();
  const [sidebarHidden, setSidebarHidden] = useState(() => readFlag(SIDEBAR_HIDDEN));
  const [tabletTabs, setTabletTabs] = useState(() => readFlag(TABLET_TABS));

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

  const hideSidebar = (on: boolean) => {
    setSidebarHidden(on);
    writeFlag(SIDEBAR_HIDDEN, on);
  };
  const chooseTabletTabs = (on: boolean) => {
    setTabletTabs(on);
    writeFlag(TABLET_TABS, on);
  };

  return (
    <div className="min-h-dvh bg-bg text-label">
      {!sidebarHidden && (
        <div className="fixed inset-y-3 start-3 z-30 hidden lg:block">
          <Sidebar compact={false} onHide={() => hideSidebar(true)} />
        </div>
      )}
      {!tabletTabs && (
        <div className="fixed inset-y-3 start-3 z-30 hidden sm:max-lg:block">
          <Sidebar compact onUseTabBar={() => chooseTabletTabs(true)} />
        </div>
      )}
      <div
        className={[
          'pb-28 sm:pb-8',
          sidebarHidden ? '' : 'lg:ps-[17.5rem]',
          tabletTabs ? 'sm:max-lg:pb-28' : 'sm:max-lg:ps-[5.5rem]',
        ].join(' ')}
      >
        <StorageBanner />
        <Toolbar
          onShowSidebar={sidebarHidden ? () => hideSidebar(false) : undefined}
          onUseSidebar={tabletTabs ? () => chooseTabletTabs(false) : undefined}
        />
        <main className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <Outlet />
        </main>
      </div>
      <div className={tabletTabs ? 'lg:hidden' : 'sm:hidden'}>
        <TabBar />
      </div>
    </div>
  );
}
