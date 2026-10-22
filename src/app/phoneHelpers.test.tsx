import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeVisualViewport, phoneMedia } from '../test/phoneMedia';
import { rememberWorkView, subscribeWorkView, workTabLink } from './lastList';
import { isPhoneChatPath, PHONE_CHAT } from './phoneChat';
import { isPhoneNow } from './useIsPhone';
import { useKeyboardOpen } from './useKeyboardOpen';
import { useVisualViewport } from './useVisualViewport';

afterEach(() => rememberWorkView('/work'));

function setInnerHeight(value: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value });
}

describe('phone helpers', () => {
  it('isPhoneNow reads the phone query, and is false with no matchMedia', () => {
    const media = phoneMedia(true);
    expect(isPhoneNow()).toBe(true);
    media.set(false);
    expect(isPhoneNow()).toBe(false);
    const original = window.matchMedia;
    // @ts-expect-error the test removes matchMedia on purpose
    delete window.matchMedia;
    try {
      expect(isPhoneNow()).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('phoneMedia answers the touch query and tells the listeners', () => {
    const media = phoneMedia({ phone: true, coarse: true });
    const phone = window.matchMedia('(max-width: 639px)');
    const coarse = window.matchMedia('(pointer: coarse)');
    expect(phone.matches).toBe(true);
    expect(coarse.matches).toBe(true);
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
    const heard = vi.fn();
    coarse.addEventListener('change', heard);
    media.setCoarse(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(coarse.matches).toBe(false);
  });

  it('isPhoneChatPath is true only for one chat id', () => {
    for (const p of ['/inbox/cnv_1', '/inbox/abc-9']) expect(isPhoneChatPath(p)).toBe(true);
    for (const p of ['/inbox', '/inbox/', '/inbox/a/b', '/notifications', '/']) expect(isPhoneChatPath(p)).toBe(false);
    expect(PHONE_CHAT.source).toBe('^\\/inbox\\/[^/]+$');
  });

  it('workTabLink starts at /work, keeps the last Work view, and tells its listeners', () => {
    expect(workTabLink()).toBe('/work');
    const seen = vi.fn();
    const stop = subscribeWorkView(seen);
    rememberWorkView('/projects');
    expect(workTabLink()).toBe('/projects');
    expect(seen).toHaveBeenCalledTimes(1);
    rememberWorkView('/projects');
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    rememberWorkView('/meetings');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('useVisualViewport gives null with no API, then follows resize and scroll, and lets go on unmount', () => {
    const none = renderHook(() => useVisualViewport());
    expect(none.result.current).toBeNull();
    none.unmount();

    const viewport = fakeVisualViewport({ height: 800, offsetTop: 0 });
    const { result, unmount } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: 800, offsetTop: 0 });
    act(() => { viewport.set({ height: 500 }); viewport.fire('resize'); });
    expect(result.current).toEqual({ height: 500, offsetTop: 0 });
    act(() => { viewport.set({ offsetTop: 40 }); viewport.fire('scroll'); });
    expect(result.current).toEqual({ height: 500, offsetTop: 40 });
    expect(viewport.listeners()).toBe(2);
    unmount();
    expect(viewport.listeners()).toBe(0);
  });

  it('useKeyboardOpen is true when the visual viewport is more than 150 px shorter than the window', () => {
    setInnerHeight(800);
    expect(renderHook(() => useKeyboardOpen()).result.current).toBe(false);
    const viewport = fakeVisualViewport({ height: 800 });
    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
    for (const [height, open] of [[651, false], [650, false], [649, true]] as const) {
      act(() => { viewport.set({ height }); viewport.fire('resize'); });
      expect(result.current, `height ${height}`).toBe(open);
    }
  });

  // A full-page screenshot, a turn of the phone and a resize of the window change the window before the visual viewport tells the hook.
  // Another render in that gap saw the new window height and the old viewport height, and the bar hid for a moment and faded back.
  it('useKeyboardOpen reads the live viewport, so a render between the window resize and the viewport event shows no keyboard', () => {
    setInnerHeight(1);
    const viewport = fakeVisualViewport({ height: 1 });
    const { result, rerender } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
    // The window and the viewport are both 900 px high now, but the viewport has not fired its event yet.
    setInnerHeight(900);
    viewport.set({ height: 900 });
    rerender();
    expect(result.current).toBe(false);
  });

  it('useKeyboardOpen stays false while the page is pinch-zoomed', () => {
    setInnerHeight(800);
    const viewport = fakeVisualViewport({ height: 400, scale: 2 });
    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
    act(() => { viewport.set({ scale: 1 }); viewport.fire('resize'); });
    expect(result.current).toBe(true);
  });
});
