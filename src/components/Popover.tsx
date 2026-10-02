import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { spring } from '../design/motion';
import { measure, popoverPlace } from './placement';

/** A small floating panel next to its control, for a short choice. Escape, a press outside or the focus moving out closes it. */
export function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus moves into the panel, to its first control or to the panel itself, so Escape always reaches it.
    (ref.current?.querySelector<HTMLElement>('input, textarea, select, button') ?? ref.current)?.focus();
  }, []);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    // Focus that lands outside (Tab past the last control) closes it too, so it never stays open where Escape cannot reach it.
    // The focus stays where the person put it, also when onClose gives it back to the control (audit 2026-10-03, SHL-20).
    let closed = false;
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (closed || !(target instanceof HTMLElement) || ref.current?.contains(target) || anchor.contains(target)) return;
      closed = true;
      onClose();
      if (document.activeElement !== target) target.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocus);
    };
  }, [anchor, onClose]);
  // The measures come in the units of the panel, so the panel opens next to its control also under Big screen.
  const { box, screen } = measure(anchor);
  const place = popoverPlace(box, screen);
  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
        anchor.focus();
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.standard}
      style={{ position: 'fixed', ...place }}
      className="float z-50 flex max-h-[min(80dvh,36rem)] flex-col gap-3 overflow-y-auto rounded-3xl p-4"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
