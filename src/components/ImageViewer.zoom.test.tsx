import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { ImageViewer } from './ImageViewer';

/**
 * The zoom of the picture viewer (fbk_038): pinch, double-tap and drag on a phone; wheel, trackpad pinch, click, drag and the keys + - 0 on a
 * computer. jsdom has no layout, so a 400 x 300 stage holds a 2000 x 1000 picture that fills its width at 1x: 400 x 200.
 */
beforeEach(() => {
  initI18n('en');
});

const pictures = ['one.jpg', 'two.jpg', 'three.jpg'];

function Demo({ onClosed = () => undefined }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <ImageViewer
        open={open}
        onClose={() => { setOpen(false); onClosed(); }}
        name={pictures[index]}
        src={`https://store.test/${pictures[index]}`}
        onDownload={() => undefined}
        position={{ index, count: pictures.length, onMove: setIndex }}
      />
    </>
  );
}

const rect = (width: number, height: number) => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });

/** Gives the stage and the loaded picture their sizes. Called again after a new picture mounts. */
async function open() {
  render(<Demo />);
  const dialog = await screen.findByRole('dialog');
  return { dialog, ...(await measure(dialog)) };
}
async function measure(dialog: HTMLElement) {
  const stage = dialog.querySelector('[data-viewer-stage]') as HTMLElement;
  stage.getBoundingClientRect = () => rect(400, 300) as DOMRect;
  const picture = dialog.querySelector('img[src^="https://store.test/"]') as HTMLImageElement;
  Object.defineProperty(picture, 'naturalWidth', { configurable: true, value: 2000 });
  Object.defineProperty(picture, 'naturalHeight', { configurable: true, value: 1000 });
  Object.defineProperty(picture, 'offsetWidth', { configurable: true, value: 400 });
  Object.defineProperty(picture, 'offsetHeight', { configurable: true, value: 300 });
  picture.getBoundingClientRect = () => rect(400, 300) as DOMRect;
  fireEvent.load(picture);
  return { stage, picture, layer: dialog.querySelector('[data-zoom-layer]') as HTMLElement };
}

/** The view that the layer draws: scale, and the move in pixels. 1x with no move has no transform. */
function view(layer: HTMLElement) {
  const text = layer.style.transform;
  if (!text) return { scale: 1, x: 0, y: 0 };
  const [, x, y, scale] = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0(?:px)?\) scale\((-?[\d.]+)\)/.exec(text) ?? [];
  return { scale: Number(scale), x: Number(x), y: Number(y) };
}
const point = (id: number, x: number, y: number, type = 'touch') => ({ pointerId: id, pointerType: type, clientX: x, clientY: y, isPrimary: id === 1, button: 0, buttons: 1 });
// The point (200, 150) is the center of the stage.

describe('the zoom of the picture viewer (fbk_038)', () => {
  it('has a zoom layer, and a stage that takes no scroll, no page zoom and no drag of the sheet', async () => {
    const { stage, layer } = await open();
    expect(stage).toHaveClass('touch-none');
    expect(stage).toHaveAttribute('data-vaul-no-drag');
    expect(layer).not.toBeNull();
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('stops the page itself from zooming in Safari (gesturestart)', async () => {
    const { stage } = await open();
    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    stage.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
  });

  it('zooms with the mouse wheel around the pointer, and a trackpad pinch (ctrl + wheel) does the same', async () => {
    const { stage, layer } = await open();
    // 100 px to the right of the center.
    expect(fireEvent.wheel(stage, { deltaY: -200, clientX: 300, clientY: 150 })).toBe(false);
    const zoomed = view(layer);
    expect(zoomed.scale).toBeCloseTo(Math.exp(0.4), 2);
    // The picture point under the pointer stays under it.
    expect(zoomed.x + zoomed.scale * 100).toBeCloseTo(100, 0);
    fireEvent.wheel(stage, { deltaY: 100, clientX: 300, clientY: 150, ctrlKey: true });
    expect(view(layer).scale).toBeLessThan(zoomed.scale);
    // The wheel never goes below 1x or above 4x.
    fireEvent.wheel(stage, { deltaY: 5000, ctrlKey: true, clientX: 200, clientY: 150 });
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
    fireEvent.wheel(stage, { deltaY: -5000, ctrlKey: true, clientX: 200, clientY: 150 });
    expect(view(layer).scale).toBe(4);
  });

  it('toggles 1x and 2.5x with a click on the picture, and closes with a click on the dark space only at 1x', async () => {
    const { stage, layer } = await open();
    // 100 px right of the center, on the picture (it fills y = 50 to 250).
    fireEvent.click(stage, { clientX: 300, clientY: 150 });
    const zoomed = view(layer);
    expect(zoomed.scale).toBe(2.5);
    expect(zoomed.x).toBeCloseTo(-150);
    // A click on the dark space, at the top, does not close a zoomed viewer.
    fireEvent.click(stage, { clientX: 200, clientY: 10 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(view(layer).scale).toBe(2.5);
    fireEvent.click(stage, { clientX: 200, clientY: 150 });
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
    fireEvent.click(stage, { clientX: 200, clientY: 10 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('zooms with + and - and goes back to 1x with 0', async () => {
    const { dialog, layer } = await open();
    fireEvent.keyDown(dialog, { key: '+' });
    const first = view(layer).scale;
    expect(first).toBeGreaterThan(1);
    fireEvent.keyDown(dialog, { key: '=' });
    expect(view(layer).scale).toBeGreaterThan(first);
    fireEvent.keyDown(dialog, { key: '-' });
    expect(view(layer).scale).toBeCloseTo(first, 5);
    fireEvent.keyDown(dialog, { key: '0' });
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('pans with a mouse drag while zoomed, and stops at the edge of the picture', async () => {
    const { stage, layer } = await open();
    fireEvent.click(stage, { clientX: 200, clientY: 150 });
    expect(view(layer)).toEqual({ scale: 2.5, x: 0, y: 0 });
    fireEvent.pointerDown(stage, point(1, 200, 150, 'mouse'));
    fireEvent.pointerMove(stage, point(1, 150, 150, 'mouse'));
    fireEvent.pointerMove(stage, point(1, 100, 100, 'mouse'));
    expect(view(layer)).toEqual({ scale: 2.5, x: -100, y: -50 });
    // The picture is 1000 x 500 at 2.5x on a 400 x 300 stage: 300 px of pan sideways, 100 px up or down.
    fireEvent.pointerMove(stage, point(1, -800, -800, 'mouse'));
    expect(view(layer)).toEqual({ scale: 2.5, x: -300, y: -100 });
    fireEvent.pointerUp(stage, point(1, -800, -800, 'mouse'));
    // The click that follows a drag is no click: the zoom stays.
    fireEvent.click(stage, { clientX: -800, clientY: -800 });
    expect(view(layer).scale).toBe(2.5);
  });

  it('does not pan at 1x', async () => {
    const { stage, layer } = await open();
    fireEvent.pointerDown(stage, point(1, 200, 150, 'mouse'));
    fireEvent.pointerMove(stage, point(1, 100, 100, 'mouse'));
    fireEvent.pointerUp(stage, point(1, 100, 100, 'mouse'));
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('zooms around the fingers with a pinch, then pans with one finger', async () => {
    const { stage, layer } = await open();
    fireEvent.pointerDown(stage, point(1, 150, 150));
    fireEvent.pointerDown(stage, point(2, 250, 150));
    fireEvent.pointerMove(stage, point(2, 350, 150));
    // The fingers are 200 apart now, so 2x, and their middle moved 50 px to the right.
    expect(view(layer)).toEqual({ scale: 2, x: 50, y: 0 });
    fireEvent.pointerUp(stage, point(2, 350, 150));
    // The finger that stays pans the picture.
    fireEvent.pointerMove(stage, point(1, 120, 150));
    expect(view(layer)).toEqual({ scale: 2, x: 20, y: 0 });
    fireEvent.pointerUp(stage, point(1, 120, 150));
  });

  it('toggles 1x and 2.5x with a double-tap at the tap point, and a single tap on the picture does nothing', async () => {
    const { stage, layer } = await open();
    const tap = (x: number, y: number) => {
      fireEvent.pointerDown(stage, point(1, x, y));
      fireEvent.pointerUp(stage, point(1, x, y));
      fireEvent.click(stage, { clientX: x, clientY: y });
    };
    tap(300, 150);
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
    tap(300, 150);
    expect(view(layer).scale).toBe(2.5);
    expect(view(layer).x).toBeCloseTo(-150);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    tap(300, 150);
    tap(300, 150);
    expect(view(layer)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('keeps the arrow keys moving between pictures, and a new picture starts at 1x', async () => {
    const { dialog, stage, layer } = await open();
    fireEvent.keyDown(dialog, { key: '+' });
    expect(view(layer).scale).toBeGreaterThan(1);
    // The zoomed viewer still moves to the next picture.
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    await screen.findByRole('dialog', { name: 'two.jpg' });
    const next = await measure(screen.getByRole('dialog'));
    expect(view(next.layer)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(next.stage).toBe(stage);
  });

  it('starts at 1x again when the viewer opens again', async () => {
    const { stage, layer } = await open();
    fireEvent.click(stage, { clientX: 200, clientY: 150 });
    expect(view(layer).scale).toBe(2.5);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => screen.getByRole('button', { name: 'Open' }).click());
    const dialog = await screen.findByRole('dialog');
    const again = await measure(dialog);
    expect(view(again.layer)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('zooms with the trackpad pinch of desktop Safari (gesturechange)', async () => {
    const { stage, layer } = await open();
    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    act(() => { stage.dispatchEvent(start); });
    const change = Object.assign(new Event('gesturechange', { bubbles: true, cancelable: true }), { scale: 2, clientX: 200, clientY: 150 });
    act(() => { stage.dispatchEvent(change); });
    expect(change.defaultPrevented).toBe(true);
    expect(view(layer).scale).toBe(2);
  });

  it('adds no button for the zoom', async () => {
    const { dialog } = await open();
    expect(Array.from(dialog.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual(['Download one.jpg', 'Close', 'Next picture']);
  });
});
