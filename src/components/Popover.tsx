import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { spring } from '../design/motion';

/** A small glass panel next to its control, for a short choice. Escape or a press outside closes it. */
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
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8); // rtl-ok: screen coordinates
  const below = rect.bottom + 300 < window.innerHeight;
  const place = below ? { top: rect.bottom + 8, left: x } : { bottom: window.innerHeight - rect.top + 8, left: x }; // rtl-ok: screen coordinates
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
      style={{ position: 'fixed', width, ...place }}
      className="glass z-50 flex max-h-[min(80dvh,36rem)] flex-col gap-3 overflow-y-auto rounded-3xl p-4 shadow-float"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
