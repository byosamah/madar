import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { TypingSignal } from '../../api/remote/wire';
import { useRuntime } from '../runtime';
import { usePageVisible } from '../usePageVisible';

/** A typist sends at most one signal in this time for one chat (chat presence design B6). */
export const TYPING_SEND_MS = 5_000;
/** The line of a typist stays this long after the last signal. It stays above TYPING_SEND_MS, so a steady typist never blinks. */
export const TYPING_SHOW_MS = 8_000;

export type TypingBoard = {
  apply(signal: TypingSignal): void;
  /** The people who type in a chat, in the order of their first signal, without the ones that expired. The same array while nothing changed. */
  typers(conversationId: string): string[];
  /** Tells a listener when a signal came, and when one expired. */
  subscribe(listener: () => void): () => void;
  /** The chats where somebody may type now: the ids that the board holds a typist for. */
  chatIds(): string[];
  /** A number that changes with every change of the board, for a snapshot. */
  version(): number;
  /** Ends the timers of the expiry. */
  stop(): void;
};

/**
 * Who types in which chat now, from the typing signals. A signal with typing true sets the time of the person; a signal with typing
 * false takes the person off. A lost stop ends by itself TYPING_SHOW_MS after the last signal. "now" is a clock, so a test sets it.
 */
export function createTypingBoard(now: () => number): TypingBoard {
  /** conversation id -> person id -> time of the last signal. A Map keeps the order of the first signal. */
  const board = new Map<string, Map<string, number>>();
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cache = new Map<string, string[]>();
  let version = 0;
  const tell = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };
  const live = (at: number) => now() - at < TYPING_SHOW_MS;
  return {
    apply(signal) {
      let people = board.get(signal.conversationId);
      if (!signal.typing) {
        if (!people?.delete(signal.userId)) return;
        tell();
        return;
      }
      if (!people) {
        people = new Map();
        board.set(signal.conversationId, people);
      }
      // A typist who had expired starts again at the end of the line.
      const before = people.get(signal.userId);
      if (before !== undefined && !live(before)) people.delete(signal.userId);
      const isNew = !people.has(signal.userId);
      people.set(signal.userId, now());
      const timer = setTimeout(() => {
        timers.delete(timer);
        tell();
      }, TYPING_SHOW_MS + 1);
      timers.add(timer);
      if (isNew) tell();
    },
    typers(conversationId) {
      const next = [...(board.get(conversationId) ?? [])].filter(([, at]) => live(at)).map(([userId]) => userId);
      const last = cache.get(conversationId);
      if (last && last.length === next.length && last.every((id, i) => id === next[i])) return last;
      cache.set(conversationId, next);
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chatIds: () => [...board.keys()],
    version: () => version,
    stop() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}

/** What LiveProvider gives: the board of the typing signals and the id of the person on this screen. */
export type TypingContextValue = { board: TypingBoard; meId: string };
export const TypingContext = createContext<TypingContextValue | null>(null);

const NO_TYPERS: string[] = [];
const NO_ROWS: ReadonlyMap<string, string[]> = new Map();
const NO_SUBSCRIBE = () => () => undefined;

/** The people who type in a chat now, without the person on this screen. With no live port, nobody. */
export function useTypers(conversationId: string): string[] {
  const value = useContext(TypingContext);
  const board = value?.board;
  const subscribe = useCallback((listener: () => void) => (board ? board.subscribe(listener) : NO_SUBSCRIBE()), [board]);
  const typers = useSyncExternalStore(subscribe, () => (board ? board.typers(conversationId) : NO_TYPERS), () => NO_TYPERS);
  const meId = value?.meId ?? '';
  return useMemo(() => (typers.includes(meId) ? typers.filter((id) => id !== meId) : typers), [typers, meId]);
}

/** For each chat where somebody types, the people, without the person on this screen (the rows of the chat list). */
export function useTypingRows(): ReadonlyMap<string, string[]> {
  const value = useContext(TypingContext);
  const board = value?.board;
  const meId = value?.meId ?? '';
  const last = useRef<{ version: number; meId: string; map: ReadonlyMap<string, string[]> }>({ version: -1, meId: '', map: NO_ROWS });
  const subscribe = useCallback((listener: () => void) => (board ? board.subscribe(listener) : NO_SUBSCRIBE()), [board]);
  const snapshot = (): ReadonlyMap<string, string[]> => {
    if (!board) return NO_ROWS;
    if (last.current.version === board.version() && last.current.meId === meId) return last.current.map;
    const map = new Map<string, string[]>();
    for (const id of board.chatIds()) {
      const people = board.typers(id).filter((userId) => userId !== meId);
      if (people.length > 0) map.set(id, people);
    }
    last.current = { version: board.version(), meId, map };
    return map;
  };
  return useSyncExternalStore(subscribe, snapshot, () => NO_ROWS);
}

/**
 * The sender of the typing signal for one chat (chat presence design B6). A change that leaves text sends typing true at once, and then
 * at most once in TYPING_SEND_MS while changes come. An empty text, stop(), a page out of view and the unmount send one typing false, when
 * a true went out. The server call is a read: its errors are ignored, and a lost signal ends by itself on the other screens. The live
 * port hears of a call that worked (afterTypingCall), so the prototype can hand the signal to other tabs.
 */
export function useTypingSender(conversationId: string): { changed(text: string): void; stop(): void } {
  const { api, live } = useRuntime();
  const meId = useContext(TypingContext)?.meId ?? '';
  const visible = usePageVisible();
  const state = useRef({ sentAt: 0, open: false, chat: conversationId });
  const latest = useRef({ api, live, meId });
  latest.current = { api, live, meId };

  const send = useCallback((typing: boolean, chat: string) => {
    const { api: client, live: port, meId: me } = latest.current;
    const signal: TypingSignal = { v: 1, conversationId: chat, userId: me, typing, at: new Date().toISOString() };
    void client.call('chats.typing', { conversationId: chat, typing }).then(() => port?.afterTypingCall?.(signal), () => undefined);
  }, []);
  // The stop goes to the chat where the true went out, so a stop after a change of chat still reaches the right line.
  const stop = useCallback(() => {
    if (!state.current.open) return;
    state.current.open = false;
    send(false, state.current.chat);
  }, [send]);
  const changed = useCallback((text: string) => {
    if (text.trim() === '') {
      stop();
      return;
    }
    const at = Date.now();
    if (state.current.open && state.current.chat === conversationId && at - state.current.sentAt < TYPING_SEND_MS) return;
    if (state.current.open && state.current.chat !== conversationId) stop();
    state.current = { sentAt: at, open: true, chat: conversationId };
    send(true, conversationId);
  }, [send, stop, conversationId]);

  // A page out of view stops the line. A change of chat and the unmount stop the line of the chat that is left.
  useEffect(() => {
    if (!visible) stop();
  }, [visible, stop]);
  useEffect(() => stop, [conversationId, stop]);
  return { changed, stop };
}
