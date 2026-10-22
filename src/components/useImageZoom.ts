import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { containedSize, IDLE, MIN_SCALE, panBy, pinchView, toggleZoom, wheelScale, zoomAround, type Point, type Size, type View } from '../lib/zoom';

/**
 * The zoom of the picture viewer (fbk_038). Pointer Events and a CSS transform only. The hook keeps the view (scale and pan) and turns the
 * gestures into it:
 * - phone: two fingers pinch around the fingers, a double-tap toggles 1x and 2.5x at the tap point, one finger pans while zoomed;
 * - computer: the wheel and the trackpad pinch (wheel with ctrlKey) zoom around the pointer, a click on the picture toggles 1x and 2.5x,
 *   a drag pans while zoomed, and the keys + - 0 zoom (the arrow keys stay with the pictures);
 * - Safari: the `gesturestart` default is stopped so the page itself never zooms, and a trackpad pinch of desktop Safari
 *   (`gesturechange`) zooms the picture.
 * The pan stops at the edges of the picture (`lib/zoom.ts`). A new picture, and a viewer that opens again, start at 1x.
 */
const TAP_MS = 350;
const DOUBLE_TAP_MS = 300;
/** Farther than this and the press was a drag, not a tap or a click. */
const DRAG_PX = 6;
/** One key press of + or - changes the scale by this factor. */
const KEY_STEP = 1.5;

type Pointer = Point & { startX: number; startY: number };
type Metrics = { stage: Size; center: Point; fit: Size };

/**
 * `stage` is the element that takes the gestures. `picture` gives the loaded picture (the big one, else the small one). `resetKey` names
 * the picture and the open state: when it changes the view goes back to 1x.
 */
export function useImageZoom({ stage, picture, resetKey }: { stage: HTMLElement | null; picture: () => HTMLImageElement | null; resetKey: string }) {
  const [state, setState] = useState<{ key: string; view: View; animate: boolean }>({ key: resetKey, view: IDLE, animate: false });
  // A new key means a new picture: the stale view is never drawn, not even for one frame.
  const view = state.key === resetKey ? state.view : IDLE;
  // The state follows the key at once, so a key that comes back (a viewer that opens again) does not bring the old view back.
  if (state.key !== resetKey) setState({ key: resetKey, view: IDLE, animate: false });
  const live = useRef({ key: resetKey, view });
  live.current = { key: resetKey, view };
  const set = useCallback((next: View, animate: boolean) => {
    live.current = { key: live.current.key, view: next };
    setState({ key: live.current.key, view: next, animate });
  }, []);

  const pictureOf = useRef(picture);
  pictureOf.current = picture;
  const metrics = useCallback((): Metrics | null => {
    const img = pictureOf.current();
    if (!stage || !img || img.naturalWidth <= 0) return null;
    const box = stage.getBoundingClientRect();
    const fit = containedSize({ width: img.offsetWidth, height: img.offsetHeight }, { width: img.naturalWidth, height: img.naturalHeight });
    // A picture or a stage without a size (not laid out yet) cannot zoom.
    if (fit.width <= 0 || box.width <= 0) return null;
    return { stage: { width: box.width, height: box.height }, center: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, fit };
  }, [stage]);
  const relative = (m: Metrics, x: number, y: number): Point => ({ x: x - m.center.x, y: y - m.center.y });

  // The pointers that are down, the gesture they make, and the last tap.
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef({ moved: false, started: 0, type: 'mouse', start: IDLE as View, startCenter: { x: 0, y: 0 } as Point, startDistance: 0 });
  const lastTap = useRef({ at: 0, x: 0, y: 0 });

  const centerOf = (m: Metrics): { center: Point; distance: number } | null => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { center: relative(m, (a.x + b.x) / 2, (a.y + b.y) / 2), distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // A press on a button (the arrows) is no gesture.
    if ((event.target as Element).closest('button')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointers.current.size === 0) gesture.current.moved = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    gesture.current.type = event.pointerType || 'mouse';
    gesture.current.started = Date.now();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that is gone cannot be captured. The gesture still works inside the stage.
    }
    const m = metrics();
    if (!m) return;
    gesture.current.start = live.current.view;
    if (pointers.current.size === 2) {
      const two = centerOf(m);
      if (two) {
        gesture.current.startCenter = two.center;
        gesture.current.startDistance = two.distance;
        // Two fingers are a pinch, never a tap or a click.
        gesture.current.moved = true;
      }
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const down = pointers.current.get(event.pointerId);
    if (!down) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    pointers.current.set(event.pointerId, { ...down, x: event.clientX, y: event.clientY });
    if (Math.hypot(event.clientX - down.startX, event.clientY - down.startY) > DRAG_PX) gesture.current.moved = true;
    const m = metrics();
    if (!m) return;
    if (pointers.current.size >= 2) {
      const two = centerOf(m);
      if (two) set(pinchView(gesture.current.start, gesture.current.startCenter, gesture.current.startDistance, two.center, two.distance, m.fit, m.stage), false);
    } else if (live.current.view.scale > MIN_SCALE) {
      set(panBy(live.current.view, dx, dy, m.fit, m.stage), false);
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const was = pointers.current.get(event.pointerId);
    if (!was) return;
    pointers.current.delete(event.pointerId);
    // A pinch that ends with one finger left goes on as a pan from that finger.
    gesture.current.start = live.current.view;
    const last = [...pointers.current.values()][0];
    if (last) {
      gesture.current.moved = true;
      return;
    }
    // A double-tap with a finger toggles the zoom at the tap point. A mouse click does this in `press`.
    const tap = event.type === 'pointerup' && gesture.current.type === 'touch' && !gesture.current.moved && Date.now() - gesture.current.started < TAP_MS;
    if (!tap) return;
    const now = Date.now();
    const before = lastTap.current;
    if (now - before.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - before.x, event.clientY - before.y) < 40) {
      lastTap.current = { at: 0, x: 0, y: 0 };
      const m = metrics();
      if (m) set(toggleZoom(live.current.view, relative(m, event.clientX, event.clientY), m.fit, m.stage), true);
    } else {
      lastTap.current = { at: now, x: event.clientX, y: event.clientY };
    }
  };

  /**
   * A click on the stage. `inside` is true when it lands on the picture. A click that ends a drag or a pinch is nothing. A mouse click on
   * the picture toggles the zoom (a finger has the double-tap). A click on the dark space closes the viewer, only at 1x.
   */
  const press = (event: MouseEvent<HTMLElement>, inside: boolean, close: () => void) => {
    if (gesture.current.moved) {
      gesture.current.moved = false;
      return;
    }
    if (inside) {
      const m = gesture.current.type === 'touch' ? null : metrics();
      if (m) set(toggleZoom(live.current.view, relative(m, event.clientX, event.clientY), m.fit, m.stage), true);
      return;
    }
    if (live.current.view.scale <= MIN_SCALE) close();
  };

  /** The keys + - 0. Returns true when the key was a zoom key. */
  const onKey = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
    const m = metrics();
    if (event.key === '0') {
      set(IDLE, true);
    } else if (event.key === '+' || event.key === '=') {
      if (m) set(zoomAround(live.current.view, live.current.view.scale * KEY_STEP, { x: 0, y: 0 }, m.fit, m.stage), true);
    } else if (event.key === '-' || event.key === '_') {
      if (m) set(zoomAround(live.current.view, live.current.view.scale / KEY_STEP, { x: 0, y: 0 }, m.fit, m.stage), true);
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  };

  // The wheel needs a listener that is not passive, so the page behind never scrolls. The gesture events are Safari only: the page must not
  // zoom, and a trackpad pinch of desktop Safari zooms the picture.
  useEffect(() => {
    if (!stage) return undefined;
    const onWheel = (event: WheelEvent) => {
      const m = metrics();
      if (!m) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const at = relative(m, event.clientX, event.clientY);
      set(zoomAround(live.current.view, wheelScale(live.current.view.scale, event.deltaY * unit, event.ctrlKey), at, m.fit, m.stage), false);
    };
    let from: View = IDLE;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      from = live.current.view;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      // On an iPhone the fingers also send pointer events, which already pinch the picture.
      if (pointers.current.size > 0) return;
      const m = metrics();
      const { scale, clientX, clientY } = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!m || typeof scale !== 'number') return;
      set(zoomAround(from, from.scale * scale, relative(m, clientX ?? m.center.x, clientY ?? m.center.y), m.fit, m.stage), false);
    };
    const stop = (event: Event) => event.preventDefault();
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('gesturestart', onGestureStart);
    stage.addEventListener('gesturechange', onGestureChange);
    stage.addEventListener('gestureend', stop);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('gesturestart', onGestureStart);
      stage.removeEventListener('gesturechange', onGestureChange);
      stage.removeEventListener('gestureend', stop);
    };
  }, [stage, metrics, set]);

  // A new picture or a closed viewer: no finger from the old one stays down.
  useEffect(() => {
    pointers.current.clear();
    gesture.current.moved = false;
  }, [resetKey]);

  const zoomed = view.scale > MIN_SCALE || view.x !== 0 || view.y !== 0;
  const layerStyle: CSSProperties | undefined = zoomed ? { transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` } : undefined;
  return {
    view,
    zoomed: view.scale > MIN_SCALE,
    animating: state.animate && state.key === resetKey,
    layerStyle,
    stageProps: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
    press,
    onKey,
  };
}
