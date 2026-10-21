import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ACTIVE_MS, REST_COMPUTER_MS, REST_PHONE_MS, deviceStateOf, restingOf, useDeviceState } from './activity';

const MIN = 60_000;

describe('deviceStateOf (chat presence design A1)', () => {
  const base = { visible: true, lastInputAt: 0, now: 0, awayByHand: false };
  it.each([
    ['in view, input 9 min ago', { now: 9 * MIN }, 'online'],
    ['in view, input 11 min ago', { now: 11 * MIN }, 'away'],
    ['in view, input just now', { now: 0 }, 'online'],
    ['out of view, input just now', { visible: false }, 'away'],
    ['Away by hand, in use', { awayByHand: true }, 'away'],
    ['Away by hand, idle and out of view', { awayByHand: true, visible: false, now: 30 * MIN }, 'away'],
  ] as const)('%s: %s', (_name, over, state) => {
    expect(deviceStateOf({ ...base, ...over })).toBe(state);
  });

  it('keeps ten minutes as the limit', () => {
    expect(ACTIVE_MS).toBe(600_000);
    expect(deviceStateOf({ ...base, now: ACTIVE_MS - 1 })).toBe('online');
    expect(deviceStateOf({ ...base, now: ACTIVE_MS })).toBe('away');
  });
});

describe('restingOf (cost step 1 and 3 of the design)', () => {
  it.each([
    ['a phone hidden 59 s', { hiddenSince: 0, now: 59_000, phone: true }, false],
    ['a phone hidden 61 s', { hiddenSince: 0, now: 61_000, phone: true }, true],
    ['a computer hidden 29 min', { hiddenSince: 0, now: 29 * MIN, phone: false }, false],
    ['a computer hidden 31 min', { hiddenSince: 0, now: 31 * MIN, phone: false }, true],
    ['a page in view', { hiddenSince: null, now: 99 * MIN, phone: true }, false],
    ['a computer hidden 61 s', { hiddenSince: 0, now: 61_000, phone: false }, false],
  ] as const)('%s', (_name, input, resting) => {
    expect(restingOf(input)).toBe(resting);
  });

  it('keeps the two rest times', () => {
    expect(REST_PHONE_MS).toBe(60_000);
    expect(REST_COMPUTER_MS).toBe(1_800_000);
  });
});

describe('useDeviceState', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
  });

  it('turns away 10 min after the last input, and online at the next key', () => {
    const { result } = renderHook(() => useDeviceState(false));
    expect(result.current).toBe('online');
    act(() => { vi.advanceTimersByTime(9 * MIN); });
    expect(result.current).toBe('online');
    act(() => { vi.advanceTimersByTime(MIN + 1000); });
    expect(result.current).toBe('away');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); });
    expect(result.current).toBe('online');
    // A later input moves the end of the ten minutes.
    act(() => { vi.advanceTimersByTime(8 * MIN); });
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    act(() => { vi.advanceTimersByTime(8 * MIN); });
    expect(result.current).toBe('online');
    act(() => { vi.advanceTimersByTime(3 * MIN); });
    expect(result.current).toBe('away');
  });

  it('counts a scroll in any pane, a wheel and a touch as use', () => {
    const { result } = renderHook(() => useDeviceState(false));
    for (const make of [() => new Event('scroll'), () => new Event('wheel'), () => new Event('touchstart')]) {
      act(() => { vi.advanceTimersByTime(11 * MIN); });
      expect(result.current).toBe('away');
      act(() => { (document.body as HTMLElement).dispatchEvent(Object.assign(make(), {})); window.dispatchEvent(make()); });
      expect(result.current).toBe('online');
    }
  });

  it('is away at once when the page hides, and online again when it shows with a recent input', () => {
    const { result } = renderHook(() => useDeviceState(false));
    const show = (visible: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    act(() => show(false));
    expect(result.current).toBe('away');
    act(() => show(true));
    expect(result.current).toBe('online');
  });

  it('is away while Away by hand is on, and online again when it goes off', () => {
    const { result, rerender } = renderHook(({ away }) => useDeviceState(away), { initialProps: { away: true } });
    expect(result.current).toBe('away');
    rerender({ away: false });
    expect(result.current).toBe('online');
  });
});
