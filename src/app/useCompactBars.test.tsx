import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCompactBars } from './useCompactBars';

function Probe() {
  return <p data-testid="compact">{String(useCompactBars())}</p>;
}

function scrollPage(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
}

describe('compact bars on scroll', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('follows the scroll direction, frame by frame', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    render(<Probe />);
    const seen: string[] = [];
    for (const y of [400, 300, 100, 500, 450]) {
      await act(async () => {
        scrollPage(y);
        await vi.advanceTimersByTimeAsync(50);
      });
      seen.push(`${y}:${screen.getByTestId('compact').textContent}`);
    }
    // lib/scroll.ts: down to 400 compact, up to 300 back, up to 100 back, down to 500 compact, up to 450 back.
    expect(seen).toEqual(['400:true', '300:false', '100:false', '500:true', '450:false']);
  });
});
