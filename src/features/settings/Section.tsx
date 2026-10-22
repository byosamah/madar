import type { ReactNode } from 'react';
import { useBare } from './bare';

/** One Settings section: a panel with its title. The Settings screen and each section file of the real build use it. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  // A sub-page of the Me tab has its own title, so the h2 stays for a screen reader only (Direction D).
  const bare = useBare();
  return (
    <section className="panel flex flex-col gap-3 p-5">
      <h2 className={bare ? 'sr-only' : 'text-section text-ink'}>{title}</h2>
      {children}
    </section>
  );
}
