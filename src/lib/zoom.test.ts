import { describe, expect, it } from 'vitest';
import { clampScale, clampView, containedSize, IDLE, MAX_SCALE, panBy, panLimit, pinchView, TAP_SCALE, toggleZoom, wheelScale, zoomAround } from './zoom';

// A 400 x 300 stage with a picture that fills its width at 1x: 400 x 200.
const STAGE = { width: 400, height: 300 };
const FIT = { width: 400, height: 200 };

describe('the picture zoom math (fbk_038)', () => {
  it('keeps the scale from 1x to 4x, and a broken number as 1x', () => {
    expect(clampScale(0.3)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('finds the size of a picture inside a box with object-fit contain', () => {
    expect(containedSize({ width: 400, height: 400 }, { width: 2000, height: 1000 })).toEqual({ width: 400, height: 200 });
    expect(containedSize({ width: 400, height: 100 }, { width: 2000, height: 1000 })).toEqual({ width: 200, height: 100 });
    expect(containedSize({ width: 400, height: 400 }, null)).toEqual({ width: 0, height: 0 });
  });

  it('lets the picture move only as far as its edge reaches the edge of the stage', () => {
    expect(panLimit(400, 400, 1)).toBe(0);
    expect(panLimit(400, 400, 2)).toBe(200);
    // A picture that is still smaller than the stage after the zoom stays in the middle.
    expect(panLimit(200, 400, 1.5)).toBe(0);
    expect(panLimit(200, 400, 3)).toBe(100);
  });

  it('clamps the pan at the edges of the picture on both axes', () => {
    // At 2.5x the picture is 1000 x 500: it may move 300 sideways and 100 up or down.
    const far = clampView({ scale: 2.5, x: 900, y: -900 }, FIT, STAGE);
    expect(far).toEqual({ scale: 2.5, x: 300, y: -100 });
    // At 1x there is no pan.
    expect(clampView({ scale: 1, x: 50, y: 50 }, FIT, STAGE)).toEqual(IDLE);
  });

  it('zooms around a point: the part of the picture under the point stays under it', () => {
    // The point sits 100 px to the right of the center. After a zoom to 2x, the picture point that was there is still there.
    const at = { x: 100, y: 0 };
    const next = zoomAround(IDLE, 2, at, FIT, STAGE);
    expect(next.scale).toBe(2);
    // A picture point p (from the center) is on screen at x + scale * p. Before: 100 = 0 + 1 * p, so p = 100. After: x + 2 * 100 = 100.
    expect(next.x + 2 * 100).toBeCloseTo(100);
    expect(next.x).toBe(-100);
  });

  it('stops the zoom at 4x and at 1x', () => {
    expect(zoomAround(IDLE, 10, { x: 0, y: 0 }, FIT, STAGE).scale).toBe(4);
    expect(zoomAround({ scale: 2, x: 0, y: 0 }, 0.2, { x: 0, y: 0 }, FIT, STAGE)).toEqual(IDLE);
  });

  it('toggles between 1x and 2.5x at the tap point', () => {
    const zoomed = toggleZoom(IDLE, { x: 100, y: 0 }, FIT, STAGE);
    expect(zoomed.scale).toBe(TAP_SCALE);
    expect(zoomed.x).toBeCloseTo(-150);
    expect(toggleZoom(zoomed, { x: 0, y: 0 }, FIT, STAGE)).toEqual(IDLE);
  });

  it('pans only while zoomed, and never past the edge', () => {
    expect(panBy(IDLE, 50, 50, FIT, STAGE)).toEqual(IDLE);
    const zoomed = { scale: 2.5, x: 290, y: 0 };
    expect(panBy(zoomed, 50, -30, FIT, STAGE)).toEqual({ scale: 2.5, x: 300, y: -30 });
  });

  it('follows two fingers: the scale is the ratio of the distances, and the point between the fingers stays between them', () => {
    // Two fingers 100 px apart around the center spread to 200 px: 2x. The center does not move.
    const spread = pinchView(IDLE, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200, FIT, STAGE);
    expect(spread).toEqual({ scale: 2, x: 0, y: 0 });
    // The same spread, while the fingers move 40 px to the right: the picture follows them.
    const moved = pinchView(IDLE, { x: 0, y: 0 }, 100, { x: 40, y: 0 }, 200, FIT, STAGE);
    expect(moved).toEqual({ scale: 2, x: 40, y: 0 });
    // Fingers that come together again end at 1x with no pan.
    expect(pinchView(spread, { x: 0, y: 0 }, 200, { x: 40, y: 0 }, 50, FIT, STAGE)).toEqual(IDLE);
    // A pinch that starts with two fingers on the same spot does nothing.
    expect(pinchView(IDLE, { x: 0, y: 0 }, 0, { x: 0, y: 0 }, 50, FIT, STAGE)).toEqual(IDLE);
  });

  it('turns a wheel turn into a scale: up zooms in, down zooms out, and a trackpad pinch is faster', () => {
    expect(wheelScale(2, -100, false)).toBeGreaterThan(2);
    expect(wheelScale(2, 100, false)).toBeLessThan(2);
    expect(wheelScale(2, -10, true) - 2).toBeGreaterThan(wheelScale(2, -10, false) - 2);
  });
});
