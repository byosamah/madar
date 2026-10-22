import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { onTestFinished, describe, expect, it } from 'vitest';
import { fakeVisualViewport, phoneMedia } from '../test/phoneMedia';
import { usePhoneBarHide } from './usePhoneBarHide';

function withRouter(path: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
}

function setInnerHeight(value: number) {
  const before = window.innerHeight;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value });
  onTestFinished(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: before }); });
}

describe('usePhoneBarHide', () => {
  it.each([['/', null], ['/inbox', null], ['/inbox/cnv_1', 'route'], ['/?focus=tsk_001', 'route'], ['/inbox/cnv_1/', null]])('at %s the value is %s on a phone', (path, value) => {
    phoneMedia(true);
    const { result } = renderHook(() => usePhoneBarHide(), { wrapper: withRouter(path) });
    expect(result.current).toBe(value);
  });

  it('is keyboard when the visual viewport is 160 px shorter', () => {
    phoneMedia(true);
    setInnerHeight(800);
    fakeVisualViewport({ height: 640 });
    const { result } = renderHook(() => usePhoneBarHide(), { wrapper: withRouter('/') });
    expect(result.current).toBe('keyboard');
  });

  it('is route, not keyboard, in a chat with the keyboard open', () => {
    phoneMedia(true);
    setInnerHeight(800);
    fakeVisualViewport({ height: 420 });
    const { result } = renderHook(() => usePhoneBarHide(), { wrapper: withRouter('/inbox/cnv_1') });
    expect(result.current).toBe('route');
  });

  it('is always null at desk width', () => {
    phoneMedia(false);
    setInnerHeight(800);
    fakeVisualViewport({ height: 420 });
    const { result } = renderHook(() => usePhoneBarHide(), { wrapper: withRouter('/inbox/cnv_1') });
    expect(result.current).toBeNull();
  });

  it('turns null when the window grows past 640 px (a phone turned sideways)', () => {
    const media = phoneMedia(true);
    const { result } = renderHook(() => usePhoneBarHide(), { wrapper: withRouter('/inbox/cnv_1') });
    expect(result.current).toBe('route');
    act(() => media.set(false));
    expect(result.current).toBeNull();
  });
});
