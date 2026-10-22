import type { ReactNode } from 'react';
import { useIsPhone } from '../app/useIsPhone';
import { Popover } from './Popover';
import { Sheet } from './Sheet';

/**
 * One choice, two shapes: a small panel next to its control on a desk, a bottom sheet on a phone. The children are the same.
 * A desk needs a mounted `anchor` and draws nothing without one. A phone ignores the anchor.
 */
export function SheetOrPopover({ open, onOpenChange, anchor, title, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: HTMLElement | null; title: string; children: ReactNode;
}) {
  const phone = useIsPhone();
  if (phone) return <Sheet open={open} onOpenChange={onOpenChange} title={title}>{children}</Sheet>;
  if (!open || !anchor) return null;
  return <Popover anchor={anchor} label={title} onClose={() => onOpenChange(false)}>{children}</Popover>;
}
