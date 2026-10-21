import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { memo } from 'react';
import { fakeLive } from '../../test/fakeLive';
import { renderWithRuntime } from '../../test/render';
import { usePersonState } from './hooks';
import { combineStates } from './types';

describe('combineStates', () => {
  it.each([
    [[], 'offline'],
    [['away'], 'away'],
    [['away', 'online'], 'online'],
    [['online'], 'online'],
    [['away', 'away'], 'away'],
  ] as const)('%j gives %s', (devices, state) => {
    expect(combineStates(devices)).toBe(state);
  });
});

let renders: Record<string, number> = {};
const Face = memo(function Face({ userId }: { userId: string }) {
  const state = usePersonState(userId);
  renders[userId] = (renders[userId] ?? 0) + 1;
  return <span data-testid={userId}>{state}</span>;
});

describe('usePersonState', () => {
  it('renders only the face of the person whose state changed', async () => {
    renders = {};
    const live = fakeLive({ usr_002: 'online', usr_003: 'away' });
    await renderWithRuntime(<><Face userId="usr_002" /><Face userId="usr_003" /><Face userId="usr_004" /></>, undefined, { live: live.port });
    expect(screen.getByTestId('usr_002').textContent).toBe('online');
    expect(screen.getByTestId('usr_003').textContent).toBe('away');
    expect(screen.getByTestId('usr_004').textContent).toBe('offline');
    // Let the first loads settle, then count.
    await waitFor(() => expect(live.log.mine.length).toBeGreaterThan(0));
    const before = { ...renders };
    act(() => live.setState('usr_003', 'online'));
    expect(screen.getByTestId('usr_003').textContent).toBe('online');
    expect(renders.usr_003).toBe(before.usr_003 + 1);
    expect(renders.usr_002).toBe(before.usr_002);
    expect(renders.usr_004).toBe(before.usr_004);
  });

  it('shows every person offline with no live port', async () => {
    renders = {};
    await renderWithRuntime(<Face userId="usr_002" />);
    expect(screen.getByTestId('usr_002').textContent).toBe('offline');
  });
});

describe('LiveProvider', () => {
  const showPage = (visible: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tells the port the active humans, the state of this device and the end of the port with the runtime', async () => {
    const live = fakeLive();
    const { unmount, store } = await renderWithRuntime(<span />, undefined, { live: live.port });
    await waitFor(() => expect(live.log.mine).toEqual(['online']));
    const humans = Object.values(store.state.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
    await waitFor(() => expect(live.log.watched.at(-1)?.slice().sort()).toEqual(humans.slice().sort()));
    expect(live.log.watched.at(-1)).not.toContain('usr_009');
    unmount();
    expect(live.log.stopped).toBe(1);
  });

  it('sends Away when the person sets Away by hand', async () => {
    const live = fakeLive();
    const { api } = await renderWithRuntime(<span />, undefined, { live: live.port });
    await waitFor(() => expect(live.log.mine).toEqual(['online']));
    await act(async () => { await api.call('me.updatePreferences', { awayByHand: true }); });
    await waitFor(() => expect(live.log.mine.at(-1)).toBe('away'));
  });

  it('sets the port to rest after 61 s hidden on a phone, and wakes it when the page shows again', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: true, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList);
    const live = fakeLive();
    await renderWithRuntime(<span />, undefined, { live: live.port });
    await waitFor(() => expect(live.log.resting).toEqual([false]));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => showPage(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(live.log.resting).toEqual([false]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(live.log.resting).toEqual([false, true]);
    act(() => showPage(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(live.log.resting).toEqual([false, true, false]);
  });
});
