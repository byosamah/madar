import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fixedFrame, inFrame, measure } from '../../components/placement';
import { spring } from '../../design/motion';

/** The width of the panel on a computer: 8 buttons of 44 px and 8 px of room at each side. */
const WIDTH = 368;
/** The height that the panel likes to have. It goes to the side of its button that has this much room. */
const WANTED = 440;

/**
 * The floating box of the emoji panel on a computer (chat presence design D2). It does what `Popover` does (it draws inside the closest
 * dialog of its button, and Escape, a press outside or a Tab out of the box close it), with two changes the panel needs: the box is 368 px
 * wide (Popover is 320 px, too narrow for 8 buttons of 44 px), and a scroll of the page behind closes it. `onClose` gets `restoreFocus`
 * true for Escape only: a press outside keeps the focus where the person put it.
 */
export function EmojiFloat({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: (restoreFocus: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // The focus moves into the box at once, so Escape reaches it while the panel still loads. The search field takes it later.
    ref.current?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) close.current(false);
    };
    // The box is placed once, so it closes when the page behind it moves. The scroll of its own list does not count.
    const onMove = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      close.current(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [anchor]);
  const { box, screen } = measure(anchor);
  const width = Math.min(WIDTH, screen.width - 16);
  const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), screen.width - width - 8); // rtl-ok: screen coordinates from the button
  const roomAbove = box.top - 16;
  const roomBelow = screen.height - box.bottom - 16;
  const above = roomAbove >= WANTED || roomAbove >= roomBelow;
  const onScreen = above
    ? { width, left, bottom: screen.height - box.top + 8, maxHeight: roomAbove } // rtl-ok: screen coordinates
    : { width, left, top: box.bottom + 8, maxHeight: roomBelow }; // rtl-ok: screen coordinates
  // A sheet that moves (a transform) is the frame of a fixed box inside it, so the place turns into the units of the sheet.
  const layer = anchor.closest<HTMLElement>('[role="dialog"]');
  const { maxHeight, ...rest } = onScreen;
  const place = layer ? inFrame(rest, fixedFrame(layer), screen) : rest;
  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close.current(true);
      }}
      // A Tab (or a focus by script) that leaves the box closes it, so it never stays open where Escape cannot reach it.
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !ref.current?.contains(next) && !anchor.contains(next)) close.current(false);
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.standard}
      // A sheet that blocks the page sets pointer events to none on the body. The box sets its own value, so it stays clickable.
      style={{ position: 'fixed', pointerEvents: 'auto', maxHeight: Math.max(160, maxHeight), ...place }}
      className="float pointer-events-auto z-50 flex flex-col overflow-hidden rounded-3xl p-2 outline-none"
    >
      {children}
    </motion.div>,
    layer ?? document.body,
  );
}
