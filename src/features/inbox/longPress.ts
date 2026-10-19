import { useCallback, useEffect, useMemo, useRef, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/** The hold time and the move limit of a long press: the values of `useContextMenu` (`components/Menu.tsx`). */
const HOLD_MS = 500;
const MOVE_PX = 10;

type Handlers = Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture' | 'onContextMenu'>;

/**
 * A long press of a finger (chat design 2026-10-19, item 9): 500 ms with the finger still, then `onLongPress` runs. A mouse and a pen
 * never start it. A move of more than 10 px (a scroll) or a lift before the time cancels it. The click that follows a long press is
 * stopped, so the press does not also open a link or a picture. A touch screen shows no browser menu for the press. The handlers keep
 * their identity, so a memoized row never renders again for them.
 */
export function useLongPress(onLongPress: () => void): Handlers {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touch = useRef(false);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return useMemo<Handlers>(() => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      fired.current = false;
      touch.current = event.pointerType === 'touch';
      if (!touch.current) return;
      start.current = { x: event.clientX, y: event.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fired.current = true;
        start.current = null;
        latest.current();
      }, HOLD_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (!fired.current) return;
      event.preventDefault();
      event.stopPropagation();
      fired.current = false;
    },
    // A touch screen opens its own menu on a long press. A computer keeps its normal menu.
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      if (touch.current) event.preventDefault();
    },
  }), [cancel]);
}
