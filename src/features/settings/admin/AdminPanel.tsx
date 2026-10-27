import type { ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';

/**
 * The panel of one Admin section: the section tag named by its title, then the content. A section with an `action` (the Add button)
 * gets the header row that wraps on a narrow screen. `action={null}` keeps the row with no button. No `action` draws the title alone.
 */
export function AdminPanel({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="surface flex flex-col gap-3 rounded-card p-5">
      {action === undefined ? (
        <h2 id={id} className="text-headline">{title}</h2>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id} className="text-headline">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The Add button of a panel header: the plus sign, then the label. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button onClick={onClick}>
      <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
      {label}
    </Button>
  );
}
