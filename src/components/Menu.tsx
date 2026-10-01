import { AnimatePresence, motion } from 'motion/react';
import { Ellipsis } from 'lucide-react';
import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { spring } from '../design/motion';

export type MenuItem = { label: string; onSelect: () => void; destructive?: boolean; hidden?: boolean };

/** The list of a menu. It takes the focus, moves with the arrow keys, and closes on Escape, Tab or a press outside. */
export function MenuList({
  label, items, onClose, boundary, className = '', style,
}: {
  label: string;
  items: MenuItem[];
  onClose: (restoreFocus: boolean) => void;
  boundary?: RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || boundary?.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [onClose, boundary]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      all[(index + 1) % all.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      all[(index - 1 + all.length) % all.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab') {
      onClose(false);
    }
  };
  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={spring.standard}
      style={style}
      className={`float z-50 flex min-w-52 flex-col rounded-2xl p-1.5 ${className}`}
    >
      {items.filter((item) => !item.hidden).map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose(true);
            item.onSelect();
          }}
          className={`flex min-h-11 w-full items-center rounded-xl px-3 text-start text-body hover:bg-fill focus:bg-fill focus:outline-none ${item.destructive ? 'text-late' : 'text-ink'}`}
        >
          {item.label}
        </button>
      ))}
    </motion.div>
  );
}

/**
 * A "…" button with a menu that grows from it (spec 10.6). It hides itself when the viewer may use no item.
 * The list draws at the page level with a fixed place, so a clipping box (a cover, a scrolling board) never cuts it off.
 */
export function Menu({ label, items, triggerClassName = '', icon }: { label: string; items: MenuItem[]; triggerClassName?: string; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    // The list has a fixed place, so it closes when the page under it moves.
    const onMove = () => close(false);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);
  if (items.every((item) => item.hidden)) return null;
  const openMenu = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = document.documentElement.dir === 'rtl';
    const height = items.filter((item) => !item.hidden).length * 44 + 12;
    const below = rect.bottom + 4 + height <= window.innerHeight;
    const vertical = below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 };
    const side = rtl ? { left: rect.left } : { right: window.innerWidth - rect.right }; // rtl-ok: screen coordinates from the button
    const origin = `${below ? 'top' : 'bottom'} ${rtl ? 'left' : 'right'}`; // rtl-ok: the menu grows from the corner of its button
    setPlace({ position: 'fixed', ...vertical, ...side, transformOrigin: origin });
    setOpen(true);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu())}
        className={`pressable grid size-11 place-items-center rounded-full ${triggerClassName || 'text-label-2 hover:bg-fill'}`}
      >
        {icon ?? <Ellipsis size={20} aria-hidden />}
      </button>
      {createPortal(
        <AnimatePresence>{open && <MenuList label={label} items={items} onClose={close} boundary={trigger} style={place} />}</AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** Right-click on desktop, or a 500 ms press on a touch screen, opens a menu at the pointer (spec 4.1). */
export function useContextMenu() {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const openAt = (x: number, y: number) => setPoint({ x: Math.min(x, window.innerWidth - 224), y: Math.min(y, window.innerHeight - 240) });
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  const handlers = {
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault();
      openAt(event.clientX, event.clientY);
    },
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'touch') return;
      fired.current = false;
      const { clientX, clientY } = event;
      start.current = { x: clientX, y: clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        openAt(clientX, clientY);
      }, 500);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A long press opens the menu. The click that follows it must not open the card.
    onClickCapture: (event: ReactMouseEvent) => {
      if (!fired.current) return;
      event.preventDefault();
      event.stopPropagation();
      fired.current = false;
    },
  };
  const close = useCallback(() => setPoint(null), []);
  return { point, close, handlers };
}

export function ContextMenu({
  label, items, point, onClose,
}: { label: string; items: MenuItem[]; point: { x: number; y: number } | null; onClose: () => void }) {
  const position = point ? { position: 'fixed' as const, top: point.y, left: point.x } : undefined; // rtl-ok: pointer coordinates are screen coordinates
  return createPortal(
    <AnimatePresence>{point && <MenuList label={label} items={items} onClose={onClose} style={position} />}</AnimatePresence>,
    document.body,
  );
}
