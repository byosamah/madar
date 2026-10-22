import { useState, type ReactNode, type RefObject } from 'react';
import { useOnceOn } from '../../app/lazyOverlay';
import { LazyFeedbackSheet } from '../../app/overlays';

/**
 * The feedback sheet ("Request a feature or report a bug") for any control that opens it: the person menu of a desk and the row of
 * the Me hub. The sheet loads in its own chunk (FL-4) and mounts at the first open and stays, so its closing animation stays.
 * `returnFocus` is the control that gets the focus back when the sheet closes. `open()` puts the focus there first, so the sheet notes
 * it as the opener, as the person menu does with its picture (audit 2026-10-03, SHL-19).
 */
export function useFeedbackSheet(returnFocus?: RefObject<HTMLElement | null>): { open(): void; sheet: ReactNode } {
  const [open, setOpen] = useState(false);
  const mounted = useOnceOn(open);
  return {
    open: () => {
      returnFocus?.current?.focus();
      setOpen(true);
    },
    sheet: mounted ? <LazyFeedbackSheet open={open} onOpenChange={setOpen} /> : null,
  };
}
