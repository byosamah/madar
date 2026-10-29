import type { ReactNode } from 'react';
import { useIsPhone } from '../app/useIsPhone';
import { Popover } from './Popover';
import { Sheet } from './Sheet';

/**
 * One choice, two shapes: a small panel next to its control on a desk, a bottom sheet on a phone. The children are the same.
 * A desk needs a mounted `anchor` and draws nothing without one. A phone ignores the anchor. `fit` is for a long list: the panel stops inside the screen
 * and its list scrolls (see Popover).
 */
export function SheetOrPopover({ open, onOpenChange, anchor, title, fit = false, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: HTMLElement | null; title: string; fit?: boolean; children: ReactNode;
}) {
  const phone = useIsPhone();
  if (phone) return <Sheet open={open} onOpenChange={onOpenChange} title={title}>{children}</Sheet>;
  if (!open || !anchor) return null;
  return <Popover anchor={anchor} label={title} fit={fit} onClose={() => onOpenChange(false)}>{children}</Popover>;
}
