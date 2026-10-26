import { act, render, renderHook, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lazyOverlay, useOnceOn } from './lazyOverlay';

function Panel({ title }: { title: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <h2>{title}</h2>
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </div>
  );
}

/** A loader that finishes when the test says so. */
function held() {
  let finish: () => void = () => undefined;
  const load = vi.fn(() => new Promise<typeof Panel>((resolve) => { finish = () => resolve(Panel); }));
  return { load, finish: () => finish() };
}

describe('lazyOverlay (performance audit 2026-10-21, FL-1 and FL-4)', () => {
  it('imports nothing until warm() or the first mount', () => {
    const { load } = held();
    lazyOverlay(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('imports once for any number of warm() calls', async () => {
    const load = vi.fn(async () => Panel);
    const part = lazyOverlay(load);
    part.warm();
    part.warm();
    await vi.waitFor(() => expect(part.isLoaded()).toBe(true));
    part.warm();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('ready() resolves when the part is in memory, and rejects when the import fails', async () => {
    const part = lazyOverlay(async () => Panel);
    await part.ready();
    expect(part.isLoaded()).toBe(true);
    const broken = lazyOverlay<object>(async () => { throw new Error('offline'); });
    await expect(broken.ready()).rejects.toThrow('offline');
    expect(broken.isLoaded()).toBe(false);
  });

  it('renders a loaded part in the first render, with no Suspense step', async () => {
    const part = lazyOverlay(async () => Panel);
    part.warm();
    await vi.waitFor(() => expect(part.isLoaded()).toBe(true));
    render(<part.Overlay title="Ready" />);
    // No await: the first render already holds the heading.
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeInTheDocument();
  });

  it('shows nothing, then the part, when it mounts before the chunk is there', async () => {
    const { load, finish } = held();
    const part = lazyOverlay(load);
    render(<part.Overlay title="Late" />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole('heading', { name: 'Late' })).toBeInTheDocument();
  });

  it('keeps the state of a part that was waiting for its chunk when the parent renders again', async () => {
    const { load, finish } = held();
    const part = lazyOverlay(load);
    const { rerender } = render(<StrictMode><part.Overlay title="A" /></StrictMode>);
    finish();
    const field = await screen.findByLabelText('draft');
    await act(async () => {
      field.focus();
    });
    const typed = screen.getByLabelText<HTMLInputElement>('draft');
    typed.value = 'half a sentence';
    typed.dispatchEvent(new Event('input', { bubbles: true }));
    rerender(<StrictMode><part.Overlay title="B" /></StrictMode>);
    expect(screen.getByRole('heading', { name: 'B' })).toBeInTheDocument();
    // The same input element stays: the part did not remount.
    expect(screen.getByLabelText('draft')).toBe(typed);
  });

  it('does not throw from warm() when the import fails, and tries again at the next call', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module')).mockResolvedValue(Panel);
    const part = lazyOverlay(load);
    part.warm();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(part.isLoaded()).toBe(false);
    part.warm();
    await vi.waitFor(() => expect(part.isLoaded()).toBe(true));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('useOnceOn', () => {
  it('turns on with the first true and stays on, so a closing animation can play', () => {
    const { result, rerender } = renderHook(({ on }) => useOnceOn(on), { initialProps: { on: false } });
    expect(result.current).toBe(false);
    rerender({ on: true });
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(true);
  });
});
