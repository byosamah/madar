import { Fragment, useCallback, useRef, type ReactNode } from 'react';
import { AnimatedIcon } from './icons/AnimatedIcon';
import { CheckIcon } from './icons/animated/check';
import type { MenuItem } from './Menu';
import { Sheet } from './Sheet';

/** The sheet closes in 0.5 s. If no end signal comes, the chosen item still runs after this time. */
const FALLBACK_MS = 600;

/**
 * The items of a Menu as a bottom sheet of 44 px rows (Direction D, on a phone). The rows keep the labels, the radio items, the
 * headings, the notes and `onPrepare` of the pop-up menu. A press closes the sheet, and the chosen item runs when the sheet has
 * closed, so an item that opens the next sheet never opens it over this one. A timer is the fallback when no end signal comes.
 * Menu loads this file on demand: the sheet package must stay out of the first load.
 */
export function MenuSheet({ label, items, open, onClose, head }: { label: string; items: MenuItem[]; open: boolean; onClose: () => void; head?: ReactNode }) {
  const chosen = useRef<MenuItem | null>(null);
  const timer = useRef(0);
  // One ref stops a double run: the end signal and the timer both call this, and the first one empties the ref.
  const run = useCallback(() => {
    window.clearTimeout(timer.current);
    const item = chosen.current;
    chosen.current = null;
    item?.onSelect();
  }, []);
  const pick = (item: MenuItem) => {
    chosen.current = item;
    onClose();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, FALLBACK_MS);
  };
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={label} onClosed={run}>
      {head && (
        <div
          className="mb-1 border-b border-hairline pb-1.5"
          onClick={(event) => {
            if ((event.target as Element).closest('[role="menuitemcheckbox"]')) onClose();
          }}
        >
          {head}
        </div>
      )}
      {/* A group, not a menu: the sheet keeps Escape for itself when no inner menu layer is open (escapeIsInner). */}
      <div role="group" aria-label={label} className="flex flex-col">
        {items.filter((item) => !item.hidden).map((item) => (
          <Fragment key={item.label}>
            {item.heading && <div className="mx-3 mt-1 border-t border-hairline pb-1 pt-3 text-footnote font-semibold text-ink-2">{item.heading}</div>}
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              onPointerDown={item.onPrepare}
              onClick={() => pick(item)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-start text-body hover:bg-fill focus:bg-fill focus:outline-none ${item.destructive ? 'text-late' : 'text-ink'}`}
            >
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.checked === true && <AnimatedIcon icon={CheckIcon} size={18} aria-hidden className="shrink-0 text-accent" />}
            </button>
            {item.note && <p className="px-3 pb-1.5 text-footnote text-ink-2">{item.note}</p>}
          </Fragment>
        ))}
      </div>
    </Sheet>
  );
}
