import { afterEach, describe, expect, it } from 'vitest';
import { inPanelUnits, menuPlace, popoverPlace, rootZoom, type Box } from './placement';

// A 1920 x 1080 screen with a 44 px button near the end of a task panel, as the browser measures it on the screen.
const SCREEN = { width: 1920, height: 1080 };
const BUTTON: Box = { top: 400, right: 1800, bottom: 444, left: 1756, width: 44 };

/** Where a fixed length lands on the screen: a zoom on the page root makes every length the panel sets that much larger. */
const onScreen = (value: unknown, zoom: number) => (value as number) * zoom;

afterEach(() => {
  document.documentElement.style.zoom = '';
});

describe('the place of a panel next to its control (final review, 2026-10-02)', () => {
  it('reads the zoom on the page root, and 1 when there is none', () => {
    expect(rootZoom()).toBe(1);
    document.documentElement.style.zoom = '1.25';
    expect(rootZoom()).toBe(1.25);
  });

  it('keeps every measure as it is with no zoom', () => {
    expect(inPanelUnits(BUTTON, SCREEN, 1)).toEqual({ box: BUTTON, screen: SCREEN });
  });

  for (const zoom of [1, 1.25]) {
    it(`opens a menu right under its button, grown from its end corner, at zoom ${zoom}`, () => {
      const { box, screen } = inPanelUnits(BUTTON, SCREEN, zoom);
      const place = menuPlace(box, screen, { itemCount: 2, rtl: false });
      // 4 px under the button, and the end edge of the menu on the end edge of the button.
      expect(onScreen(place.top, zoom)).toBeCloseTo(BUTTON.bottom + 4 * zoom);
      expect(SCREEN.width - onScreen(place.right, zoom)).toBeCloseTo(BUTTON.right);
      expect(place.position).toBe('fixed');
    });

    it(`opens a menu right above its button near the bottom of the screen, at zoom ${zoom}`, () => {
      const low: Box = { ...BUTTON, top: 1000, bottom: 1044 };
      const { box, screen } = inPanelUnits(low, SCREEN, zoom);
      const place = menuPlace(box, screen, { itemCount: 3, rtl: false });
      expect(SCREEN.height - onScreen(place.bottom, zoom)).toBeCloseTo(low.top - 4 * zoom);
    });

    it(`opens a menu from the start edge of its button in Arabic, at zoom ${zoom}`, () => {
      const start: Box = { top: 400, right: 164, bottom: 444, left: 120, width: 44 };
      const { box, screen } = inPanelUnits(start, SCREEN, zoom);
      const place = menuPlace(box, screen, { itemCount: 2, rtl: true });
      expect(onScreen(place.left, zoom)).toBeCloseTo(start.left);
    });

    it(`centres a popover under its control, at zoom ${zoom}`, () => {
      // A control in the middle of the screen, so the edge of the screen does not push the popover.
      const middle: Box = { top: 400, right: 982, bottom: 444, left: 938, width: 44 };
      const { box, screen } = inPanelUnits(middle, SCREEN, zoom);
      const place = popoverPlace(box, screen);
      expect(onScreen(place.top, zoom)).toBeCloseTo(middle.bottom + 8 * zoom);
      expect(onScreen(place.left + place.width / 2, zoom)).toBeCloseTo(middle.left + middle.width / 2);
    });
  }
});
