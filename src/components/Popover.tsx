import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { spring } from '../design/motion';
import { measure, popoverPlace } from './placement';

/** A small floating panel next to its control, for a short choice. Escape or a press outside closes it. */
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
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
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
