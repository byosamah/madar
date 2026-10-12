import { afterEach, describe, expect, it } from 'vitest';
import { inFrame, inPanelUnits, menuPlace, popoverPlace, rootZoom, type Box } from './placement';

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

// A tall popover (the lead list of a task row, up to 36 rem) must fit the screen: the phone check of fbk_006 (2026-10-12) found it
// hanging below the end of a 390 x 844 screen, with its last row out of reach. A "fit" popover takes the side with room and its
// height never passes that room, so the panel scrolls inside itself.
describe('a tall popover that fits the screen', () => {
  const PHONE = { width: 390, height: 844 };
  const control = (top: number): Box => ({ top, right: 380, bottom: top + 28, left: 340, width: 40 });

  it('keeps the old place and sets no height when "fit" is not asked', () => {
    const place = popoverPlace(control(200), PHONE);
    expect(place).toMatchObject({ top: 236 });
    expect('maxHeight' in place).toBe(false);
  });

  it('opens below the control and stops at the end of the screen, when the room below is the larger', () => {
    const place = popoverPlace(control(200), PHONE, { fit: true });
    expect(place.top).toBe(236);
    expect(place.bottom).toBeUndefined();
    // 844 - 228 (the control end) - 8 (the gap) - 8 (the edge of the screen)
    expect(place.maxHeight).toBe(600);
  });

  it('opens above the control, and stops at the top of the screen, when the room above is the larger', () => {
    const place = popoverPlace(control(700), PHONE, { fit: true });
    expect(place.top).toBeUndefined();
    expect(place.bottom).toBe(844 - 700 + 8);
    // 700 (the control top) - 8 (the gap) - 8 (the edge of the screen)
    expect(place.maxHeight).toBe(684);
  });

  it('stays below, with the full height, when the whole panel fits there', () => {
    const place = popoverPlace(control(100), PHONE, { fit: true, expected: 400 });
    expect(place.top).toBe(136);
    expect(place.maxHeight).toBe(700);
  });
});

describe('a menu inside a sheet that moves (audit 2026-10-03, SHL-1)', () => {
  // A bottom sheet on a 390 x 844 phone: its top edge sits at 120 px and it fills the width (padding box 1..389).
  const PHONE = { width: 390, height: 844 };
  const SHEET = { top: 120, right: 389, bottom: 843, left: 1, width: 388, height: 723 };

  it('keeps the menu next to its button when the sheet is the frame of its fixed place', () => {
    const button: Box = { top: 500, right: 370, bottom: 544, left: 326, width: 44 };
    const place = menuPlace(button, PHONE, { itemCount: 2, rtl: false });
    const local = inFrame(place, SHEET, PHONE);
    // The menu's top edge lands 4 px under the button, and its end edge lines up with the button, on the screen.
    expect(SHEET.top + (local.top as number)).toBe(button.bottom + 4);
    expect(SHEET.right - (local.right as number)).toBe(button.right);
  });

  it('opens above the button near the bottom, still next to it', () => {
    const button: Box = { top: 780, right: 60, bottom: 824, left: 16, width: 44 };
    const local = inFrame(menuPlace(button, PHONE, { itemCount: 3, rtl: true }), SHEET, PHONE);
    expect(SHEET.bottom - (local.bottom as number)).toBe(button.top - 4);
    expect(SHEET.left + (local.left as number)).toBe(button.left);
  });

  it('changes nothing when the window is the frame, or when nothing has a size', () => {
    const place = menuPlace(BUTTON, SCREEN, { itemCount: 2, rtl: false });
    expect(inFrame(place, { top: 0, right: SCREEN.width, bottom: SCREEN.height, left: 0, width: SCREEN.width, height: SCREEN.height }, SCREEN)).toEqual(place);
    expect(inFrame(place, { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }, SCREEN)).toEqual(place);
  });
});
