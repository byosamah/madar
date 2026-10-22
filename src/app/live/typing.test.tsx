import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MadarApi } from '../../api/calls';
import type { TypingSignal } from '../../api/remote/wire';
import { fakeLive } from '../../test/fakeLive';
import { RuntimeProvider, createQueryClient } from '../runtime';
import { TYPING_SEND_MS, TYPING_SHOW_MS, createTypingBoard, useTypers, useTypingRows, useTypingSender } from './typing';

const signal = (userId: string, typing = true, conversationId = 'cnv_013'): TypingSignal => ({ v: 1, conversationId, userId, typing, at: '2026-10-04T06:00:00.000Z' });

describe('the numbers of the design (cost step 2 of the proof)', () => {
  it('sends a signal every 5 s and shows a typist for 8 s, above the send time', () => {
    expect(TYPING_SEND_MS).toBe(5_000);
    expect(TYPING_SHOW_MS).toBe(8_000);
    expect(TYPING_SHOW_MS).toBeGreaterThan(TYPING_SEND_MS);
  });
});

describe('the typing board', () => {
  it('drops a typist 8 s after the last signal', () => {
    let clock = 0;
    const board = createTypingBoard(() => clock);
    board.apply(signal('usr_002'));
    expect(board.typers('cnv_013')).toEqual(['usr_002']);
    clock = 7_999;
    expect(board.typers('cnv_013')).toEqual(['usr_002']);
    // A new signal moves the end.
    board.apply(signal('usr_002'));
    clock = 15_000;
    expect(board.typers('cnv_013')).toEqual(['usr_002']);
    clock = 15_999;
    expect(board.typers('cnv_013')).toEqual([]);
    board.stop();
  });

  it('keeps the order of the first signal', () => {
    let clock = 0;
    const board = createTypingBoard(() => clock);
    board.apply(signal('usr_003'));
    clock = 1_000;
    board.apply(signal('usr_002'));
    clock = 2_000;
    board.apply(signal('usr_003'));
    expect(board.typers('cnv_013')).toEqual(['usr_003', 'usr_002']);
    // A typist who expired and comes back goes to the end.
    clock = 5_000;
    board.apply(signal('usr_002'));
    clock = 10_500;
    expect(board.typers('cnv_013')).toEqual(['usr_002']);
    board.apply(signal('usr_003'));
    expect(board.typers('cnv_013')).toEqual(['usr_002', 'usr_003']);
    board.stop();
  });

  it('takes a typist off at a stop, and keeps the chats apart', () => {
    const board = createTypingBoard(() => 0);
    board.apply(signal('usr_002'));
    board.apply(signal('usr_003', true, 'cnv_001'));
    board.apply(signal('usr_002', false));
    expect(board.typers('cnv_013')).toEqual([]);
    expect(board.typers('cnv_001')).toEqual(['usr_003']);
    board.apply(signal('usr_009', false));
    board.stop();
  });

  it('gives the same array while nothing changed, and tells a listener when a signal comes and when one expires', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const board = createTypingBoard(Date.now);
    const heard = vi.fn();
    board.subscribe(heard);
    board.apply(signal('usr_002'));
    expect(heard).toHaveBeenCalledTimes(1);
    const first = board.typers('cnv_013');
    expect(board.typers('cnv_013')).toBe(first);
    vi.advanceTimersByTime(TYPING_SHOW_MS + 2);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(board.typers('cnv_013')).toEqual([]);
    board.stop();
    vi.useRealTimers();
  });
});

/** A runtime whose api answers the three calls that the live part makes, and records chats.typing. */
function harness() {
  const live = fakeLive();
  const typingCalls: { conversationId: string; typing: boolean }[] = [];
  const call = vi.fn(async (name: string, input: unknown) => {
    if (name === 'users.list') return [];
    if (name === 'session.get') return { user: { id: 'usr_001', preferences: {} } };
    if (name === 'chats.typing') {
      typingCalls.push(input as { conversationId: string; typing: boolean });
      return { sent: 1 };
    }
    throw new Error(`unexpected ${name}`);
  });
  const api = { call } as unknown as MadarApi;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RuntimeProvider runtime={{ api, live: live.port }} queryClient={createQueryClient()}>{children}</RuntimeProvider>
  );
  return { live, typingCalls, wrapper, call };
}

describe('the typing sender', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
  });

  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('sends once for 5 changes in 4 s, and again after 5 s', async () => {
    const { wrapper, typingCalls } = harness();
    const { result } = renderHook(() => useTypingSender('cnv_013'), { wrapper });
    await flush();
    for (const text of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      act(() => result.current.changed(text));
      await pass(800);
    }
    await flush();
    expect(typingCalls).toEqual([{ conversationId: 'cnv_013', typing: true }]);
    await pass(1_000);
    act(() => result.current.changed('abcdef'));
    await flush();
    expect(typingCalls).toEqual([{ conversationId: 'cnv_013', typing: true }, { conversationId: 'cnv_013', typing: true }]);
  });

  it('sends one stop for an empty text, and none when nothing went out', async () => {
    const { wrapper, typingCalls } = harness();
    const { result } = renderHook(() => useTypingSender('cnv_013'), { wrapper });
    await flush();
    act(() => result.current.changed(''));
    act(() => result.current.stop());
    await flush();
    expect(typingCalls).toEqual([]);
    act(() => result.current.changed('hello'));
    act(() => result.current.changed(''));
    act(() => result.current.changed(''));
    await flush();
    expect(typingCalls).toEqual([{ conversationId: 'cnv_013', typing: true }, { conversationId: 'cnv_013', typing: false }]);
  });

  it('sends a stop at the unmount, and a stop when the page hides', async () => {
    const { wrapper, typingCalls } = harness();
    const { result, unmount } = renderHook(() => useTypingSender('cnv_013'), { wrapper });
    await flush();
    act(() => result.current.changed('hello'));
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(typingCalls.map((c) => c.typing)).toEqual([true, false]);
    Reflect.deleteProperty(document, 'hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => result.current.changed('again'));
    unmount();
    await flush();
    expect(typingCalls.map((c) => c.typing)).toEqual([true, false, true, false]);
  });

  it('sends the stop to the chat that was left', async () => {
    const { wrapper, typingCalls } = harness();
    const { result, rerender } = renderHook(({ id }) => useTypingSender(id), { wrapper, initialProps: { id: 'cnv_013' } });
    await flush();
    act(() => result.current.changed('hello'));
    rerender({ id: 'cnv_001' });
    await flush();
    expect(typingCalls).toEqual([{ conversationId: 'cnv_013', typing: true }, { conversationId: 'cnv_013', typing: false }]);
  });

  it('hands a signal that the server accepted to the port, and ignores a refused call', async () => {
    const { wrapper, live, call } = harness();
    const { result } = renderHook(() => useTypingSender('cnv_013'), { wrapper });
    await flush();
    act(() => result.current.changed('hello'));
    await flush();
    expect(live.log.afterTyping).toEqual([expect.objectContaining({ v: 1, conversationId: 'cnv_013', userId: 'usr_001', typing: true })]);
    call.mockImplementation(async (name: string) => {
      if (name === 'chats.typing') throw new Error('refused');
      return name === 'users.list' ? [] : { user: { id: 'usr_001', preferences: {} } };
    });
    await pass(6_000);
    act(() => result.current.changed('hello again'));
    await flush();
    expect(live.log.afterTyping).toHaveLength(1);
  });
});

describe('the typing sender when nobody can see the line (DF-10)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const withLive = (states: Record<string, 'online' | 'away' | 'offline'>, known: string[]) => {
    const live = fakeLive(states, known);
    const typingCalls: { conversationId: string; typing: boolean }[] = [];
    const call = vi.fn(async (name: string, input: unknown) => {
      if (name === 'users.list') return [];
      if (name === 'session.get') return { user: { id: 'usr_001', preferences: {} } };
      if (name === 'chats.typing') {
        typingCalls.push(input as { conversationId: string; typing: boolean });
        return { sent: 1 };
      }
      throw new Error(`unexpected ${name}`);
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RuntimeProvider runtime={{ api: { call } as unknown as MadarApi, live: live.port }} queryClient={createQueryClient()}>{children}</RuntimeProvider>
    );
    return { live, typingCalls, wrapper };
  };

  it('sends no call while every other member is known and Offline', async () => {
    const { wrapper, typingCalls, live } = withLive({ usr_002: 'offline', usr_003: 'offline' }, ['usr_002', 'usr_003']);
    const { result } = renderHook(() => useTypingSender('cnv_013', ['usr_002', 'usr_003']), { wrapper });
    await flush();
    for (const text of ['a', 'ab', 'abc']) {
      act(() => result.current.changed(text));
      await pass(3_000);
    }
    act(() => result.current.changed(''));
    await flush();
    expect(typingCalls).toEqual([]);
    expect(live.log.afterTyping).toEqual([]);
  });

  it('sends at the next change when a member comes Online or Away, and the stop follows', async () => {
    const { wrapper, typingCalls, live } = withLive({ usr_002: 'offline' }, ['usr_002']);
    const { result } = renderHook(() => useTypingSender('cnv_013', ['usr_002']), { wrapper });
    await flush();
    act(() => result.current.changed('a'));
    await flush();
    expect(typingCalls).toEqual([]);
    act(() => live.setState('usr_002', 'away'));
    act(() => result.current.changed('ab'));
    await flush();
    expect(typingCalls).toEqual([{ conversationId: 'cnv_013', typing: true }]);
    act(() => result.current.changed(''));
    await flush();
    expect(typingCalls.map((c) => c.typing)).toEqual([true, false]);
  });

  it('still sends when the state of one member is unknown, or when the member list is not known', async () => {
    const unknown = withLive({ usr_002: 'offline' }, ['usr_002']);
    const first = renderHook(() => useTypingSender('cnv_013', ['usr_002', 'usr_003']), { wrapper: unknown.wrapper });
    await flush();
    act(() => first.result.current.changed('a'));
    await flush();
    expect(unknown.typingCalls).toHaveLength(1);
    const noList = withLive({ usr_002: 'offline' }, ['usr_002']);
    const second = renderHook(() => useTypingSender('cnv_013'), { wrapper: noList.wrapper });
    await flush();
    act(() => second.result.current.changed('a'));
    await flush();
    expect(noList.typingCalls).toHaveLength(1);
  });

  it('still sends for a port that cannot tell whether it knows a state', async () => {
    const { wrapper, typingCalls, live } = withLive({}, []);
    Reflect.deleteProperty(live.port, 'knowsState');
    const { result } = renderHook(() => useTypingSender('cnv_013', ['usr_002']), { wrapper });
    await flush();
    act(() => result.current.changed('a'));
    await flush();
    expect(typingCalls).toHaveLength(1);
  });

  it('sends the stop of a line that went out, also when every member is Offline by then', async () => {
    const { wrapper, typingCalls, live } = withLive({ usr_002: 'online' }, ['usr_002']);
    const { result } = renderHook(() => useTypingSender('cnv_013', ['usr_002']), { wrapper });
    await flush();
    act(() => result.current.changed('a'));
    act(() => live.setState('usr_002', 'offline'));
    act(() => result.current.changed(''));
    await flush();
    expect(typingCalls.map((c) => c.typing)).toEqual([true, false]);
  });
});

describe('useTypers and useTypingRows', () => {
  it('give the typists of a chat without the own id, from the signals of the port', async () => {
    const { wrapper, live } = harness();
    const { result } = renderHook(() => ({ typers: useTypers('cnv_013'), rows: useTypingRows() }), { wrapper });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(result.current.typers).toEqual([]);
    act(() => live.emitTyping(signal('usr_002')));
    act(() => live.emitTyping(signal('usr_001')));
    act(() => live.emitTyping(signal('usr_003', true, 'cnv_001')));
    expect(result.current.typers).toEqual(['usr_002']);
    expect([...result.current.rows.entries()]).toEqual([['cnv_013', ['usr_002']], ['cnv_001', ['usr_003']]]);
    act(() => live.emitTyping(signal('usr_002', false)));
    expect(result.current.typers).toEqual([]);
    expect([...result.current.rows.keys()]).toEqual(['cnv_001']);
  });

  it('give nobody with no live port', () => {
    const { result } = renderHook(() => ({ typers: useTypers('cnv_013'), rows: useTypingRows() }));
    expect(result.current.typers).toEqual([]);
    expect(result.current.rows.size).toBe(0);
  });
});
