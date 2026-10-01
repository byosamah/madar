import { SlidersHorizontal } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../app/useIsPhone';
import { Popover } from './Popover';
import { Sheet } from './Sheet';

/** One button for every choice of a list (redesign spec 2.4). A popover on a computer, a sheet on a phone. */
export function FilterButton({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    ref.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={count > 0 ? t('filter.withCount', { label, n: count }) : label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="pressable panel inline-flex min-h-11 items-center gap-2 !rounded-full px-4 text-subheadline font-semibold text-ink"
      >
        <SlidersHorizontal size={16} aria-hidden />
        {label}
        {count > 0 && <span className="tabular grid min-w-5 place-items-center rounded-full bg-ink px-1.5 text-caption text-panel">{count}</span>}
      </button>
      {open && !phone && ref.current && <Popover anchor={ref.current} label={label} onClose={close}>{children}</Popover>}
      {phone && <Sheet open={open} onOpenChange={(value) => (value ? setOpen(true) : close())} title={label} blocking={false}>{children}</Sheet>}
    </>
  );
}
