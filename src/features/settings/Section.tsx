import type { ReactNode } from 'react';

/** One Settings section: a panel with its title. The Settings screen and each section file of the real build use it. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel flex flex-col gap-3 p-5">
      <h2 className="text-section text-ink">{title}</h2>
      {children}
    </section>
  );
}
