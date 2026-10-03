import type { CSSProperties } from 'react';

/** A box on the screen, as getBoundingClientRect gives it. */
export type Box = { top: number; right: number; bottom: number; left: number; width: number };
/** The size of the window. */
export type Screen = { width: number; height: number };

/** The zoom on the page root. Big screen sets 1.25 there. With no zoom it is 1. */
export function rootZoom(root: HTMLElement = document.documentElement): number {
  const value = Number.parseFloat(root.style.zoom || getComputedStyle(root).zoom || '');
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * The box of a control and the size of the window in the units of a fixed panel. The browser measures both on the screen,
 * but a zoom on the page root (Big screen) makes every length a panel sets that much larger. So both divide by the zoom,
 * and the panel lands next to its control. With no zoom they stay as they are.
 */
export function inPanelUnits(box: Box, screen: Screen, zoom: number): { box: Box; screen: Screen } {
  if (zoom === 1) return { box, screen };
  return {
    box: { top: box.top / zoom, right: box.right / zoom, bottom: box.bottom / zoom, left: box.left / zoom, width: box.width / zoom }, // rtl-ok: screen coordinates
    screen: { width: screen.width / zoom, height: screen.height / zoom },
  };
}

/** Measures a control and the window for the place of a fixed panel. */
export function measure(element: HTMLElement): { box: Box; screen: Screen } {
  return inPanelUnits(element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, rootZoom());
}

/**
 * The place of a menu: under its button, or above it when the screen ends first. It grows from its button toward the start side;
 * near the screen edge it stays 8 px inside the screen.
 */
export function menuPlace(box: Box, screen: Screen, { itemCount, rtl }: { itemCount: number; rtl: boolean }): CSSProperties {
  const height = itemCount * 44 + 12;
  const below = box.bottom + 4 + height <= screen.height;
  const vertical = below ? { top: box.bottom + 4 } : { bottom: screen.height - box.top + 4 };
  const width = 224;
  const side = rtl
    ? (box.left + width <= screen.width - 8 ? { left: box.left } : { right: 8 }) // rtl-ok: screen coordinates from the button
    : (box.right - width >= 8 ? { right: screen.width - box.right } : { left: 8 }); // rtl-ok: screen coordinates from the button
  const origin = `${below ? 'top' : 'bottom'} ${rtl ? 'left' : 'right'}`; // rtl-ok: the menu grows from the corner of its button
  return { position: 'fixed', ...vertical, ...side, transformOrigin: origin };
}

/**
 * The box that a fixed panel inside this element is placed in. A transform, a filter or will-change on the element (a sheet
 * that slides in) makes the element that box; with none of them it is the window. A hidden probe measures it.
 */
export function fixedFrame(element: HTMLElement): Box & { height: number } {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none';
  element.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  const zoom = rootZoom();
  return { top: rect.top / zoom, right: rect.right / zoom, bottom: rect.bottom / zoom, left: rect.left / zoom, width: rect.width / zoom, height: rect.height / zoom }; // rtl-ok: screen coordinates
}

/** A fixed place on the screen, moved into a frame from fixedFrame. A frame with no size (no layout, as in tests) changes nothing. */
export function inFrame(place: CSSProperties, frame: Box & { height: number }, screen: Screen): CSSProperties {
  if (frame.width === 0 && frame.height === 0) return place;
  const out: CSSProperties = { ...place };
  if (typeof place.top === 'number') out.top = place.top - frame.top;
  if (typeof place.bottom === 'number') out.bottom = place.bottom - (screen.height - frame.bottom);
  if (typeof place.left === 'number') out.left = place.left - frame.left; // rtl-ok: screen coordinates
  if (typeof place.right === 'number') out.right = place.right - (screen.width - frame.right); // rtl-ok: screen coordinates
  return out;
}

/** The place of a popover: centred under its control, or above it when the screen ends first, and 8 px inside the screen. */
export function popoverPlace(box: Box, screen: Screen): { width: number; left: number; top?: number; bottom?: number } {
  const width = Math.min(320, screen.width - 16);
  const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), screen.width - width - 8);
  const below = box.bottom + 300 < screen.height;
  return below ? { width, top: box.bottom + 8, left } : { width, bottom: screen.height - box.top + 8, left }; // rtl-ok: screen coordinates
}
