import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bubble } from './MessageBubble';
import { useBubbles } from './bubbles';

// Performance audit 2026-10-21, RN-4: a page of 200 messages slides by one when a message comes. Every view after the shift is a new
// object, so the bubbles must be found again by the id of the message, and only a changed view makes a new bubble.
type View = { id: string; body: string };
const page = (from: number, to: number, body = (n: number) => `Note ${n}`): View[] => Array.from({ length: to - from }, (_, i) => ({ id: `m${from + i}`, body: body(from + i) }));
const make = (view: View): Bubble => ({ id: view.id, body: view.body }) as unknown as Bubble;
const idOf = (view: View) => view.id;

describe('useBubbles by message id (RN-4)', () => {
  it('builds one bubble for a message that comes, not 200', () => {
    const toBubble = vi.fn(make);
    const { result, rerender } = renderHook(({ views }) => useBubbles(views, toBubble, undefined, idOf), { initialProps: { views: page(0, 200) } });
    expect(toBubble).toHaveBeenCalledTimes(200);
    const first = result.current;
    toBubble.mockClear();
    // The window slides: m0 leaves, m200 comes, and every view is a new object with the same content.
    rerender({ views: page(1, 201) });
    expect(toBubble).toHaveBeenCalledTimes(1);
    expect(result.current).toHaveLength(200);
    expect(result.current[0]).toBe(first[1]);
    expect(result.current[198]).toBe(first[199]);
  });

  it('builds a new bubble for a message whose content changed', () => {
    const toBubble = vi.fn(make);
    const { result, rerender } = renderHook(({ views }) => useBubbles(views, toBubble, undefined, idOf), { initialProps: { views: page(0, 5) } });
    const first = result.current;
    toBubble.mockClear();
    rerender({ views: page(0, 5, (n) => (n === 2 ? 'Edited' : `Note ${n}`)) });
    expect(toBubble).toHaveBeenCalledTimes(1);
    expect(result.current[2]).not.toBe(first[2]);
    expect(result.current[2]!.body).toBe('Edited');
    expect(result.current[3]).toBe(first[3]);
  });

  it('starts again when the reset key changes', () => {
    const toBubble = vi.fn(make);
    const { rerender } = renderHook(({ views, key }) => useBubbles(views, toBubble, key, idOf), { initialProps: { views: page(0, 4), key: 'a' } });
    toBubble.mockClear();
    rerender({ views: page(0, 4), key: 'b' });
    expect(toBubble).toHaveBeenCalledTimes(4);
  });

  it('keeps the old rule without an id: a new view object is a new bubble', () => {
    const toBubble = vi.fn(make);
    const { rerender } = renderHook(({ views }) => useBubbles(views, toBubble), { initialProps: { views: page(0, 3) } });
    toBubble.mockClear();
    rerender({ views: page(0, 3) });
    expect(toBubble).toHaveBeenCalledTimes(3);
  });

  it('builds a new bubble when the key of the id changes for the same message', () => {
    // The caller adds a mark to the key when the outbox claims the message, so the bubble gets its fromOutbox flag.
    const toBubble = vi.fn(make);
    let claimed = false;
    const keyOf = (view: View) => (claimed ? `${view.id}#claimed` : view.id);
    const { rerender } = renderHook(({ views }) => useBubbles(views, toBubble, undefined, keyOf), { initialProps: { views: page(0, 3) } });
    toBubble.mockClear();
    claimed = true;
    rerender({ views: page(0, 3) });
    expect(toBubble).toHaveBeenCalledTimes(3);
  });

  it('forgets the ids of messages that left, so the cache does not grow for ever', () => {
    const toBubble = vi.fn(make);
    const { rerender } = renderHook(({ views }) => useBubbles(views, toBubble, undefined, idOf), { initialProps: { views: page(0, 10) } });
    rerender({ views: page(2000, 2300) });
    rerender({ views: page(2000, 2010) });
    toBubble.mockClear();
    // m0 is gone from the cache: when it comes back it is built again.
    rerender({ views: page(0, 10) });
    expect(toBubble).toHaveBeenCalledTimes(10);
  });
});
