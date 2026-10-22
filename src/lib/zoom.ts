/**
 * The math of the picture zoom (fbk_038). The viewer draws the picture with a CSS transform `translate(x, y) scale(scale)` about the
 * center of the stage. All points are in pixels from that center. These functions are pure: the viewer (`components/useImageZoom.ts`)
 * reads the sizes and the pointers, and asks them for the next view.
 */
export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** The zoom of a double-tap and of a click. */
export const TAP_SCALE = 2.5;
export const IDLE: View = { scale: 1, x: 0, y: 0 };

/** A scale from 1x to 4x. A number that is not a number is 1x. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The size of a picture inside a box with object-fit: contain. Without the natural size, nothing. */
export function containedSize(box: Size, natural: Size | null): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * How far the picture may move from the center on one axis. The picture edge may not pass the edge of the stage, so no part of the
 * picture is lost off screen. A picture that is not bigger than the stage stays in the middle.
 */
export function panLimit(picture: number, stage: number, scale: number): number {
  return Math.max(0, (picture * scale - stage) / 2);
}

const within = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value)) + 0;

/** The view with its scale and its pan kept inside the limits. `fit` is the size of the picture at 1x. */
export function clampView(view: View, fit: Size, stage: Size): View {
  const scale = clampScale(view.scale);
  return { scale, x: within(view.x, panLimit(fit.width, stage.width, scale)), y: within(view.y, panLimit(fit.height, stage.height, scale)) };
}

/** A new scale, with the part of the picture under `at` kept under it. */
export function zoomAround(view: View, scale: number, at: Point, fit: Size, stage: Size): View {
  const next = clampScale(scale);
  const ratio = next / view.scale;
  return clampView({ scale: next, x: at.x - ratio * (at.x - view.x), y: at.y - ratio * (at.y - view.y) }, fit, stage);
}

/** A double-tap or a click: back to 1x when zoomed, else 2.5x at the point. */
export function toggleZoom(view: View, at: Point, fit: Size, stage: Size): View {
  return view.scale > MIN_SCALE + 0.001 ? IDLE : zoomAround(view, TAP_SCALE, at, fit, stage);
}

/** One finger or a mouse drag. At 1x the picture does not move. */
export function panBy(view: View, dx: number, dy: number, fit: Size, stage: Size): View {
  if (view.scale <= MIN_SCALE) return view;
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, fit, stage);
}

/**
 * Two fingers. The scale is the first scale times the ratio of the distances. The point that was between the fingers at the start
 * follows the middle of the fingers now, so the picture zooms around the fingers and moves with them.
 */
export function pinchView(start: View, startCenter: Point, startDistance: number, center: Point, distance: number, fit: Size, stage: Size): View {
  if (startDistance <= 0) return start;
  const scale = clampScale(start.scale * (distance / startDistance));
  const ratio = scale / start.scale;
  return clampView({ scale, x: center.x - ratio * (startCenter.x - start.x), y: center.y - ratio * (startCenter.y - start.y) }, fit, stage);
}

/** The scale after one turn of the wheel (deltaY in pixels). A trackpad pinch (ctrlKey) sends small steps, so it counts more. */
export function wheelScale(scale: number, deltaY: number, pinch: boolean): number {
  return scale * Math.exp(-deltaY * (pinch ? 0.01 : 0.002));
}
