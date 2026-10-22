import type { TypingSignal } from '../api/remote/wire';
import type { DeviceState, LivePort, PersonState } from '../app/live/types';

/**
 * A live port for tests (chat presence design). It keeps the states a test sets, records what the screens tell it, and lets a test
 * send a typing signal. The real adapters are the work of the track live.
 */
export function fakeLive(initial: Record<string, PersonState> = {}, known: string[] = []) {
  const states = new Map(Object.entries(initial));
  // The people whose state the port knows (DF-10). A person not in the set is unknown, whatever stateOf answers.
  const knownIds = new Set(known);
  const stateListeners = new Set<() => void>();
  const typingListeners = new Set<(signal: TypingSignal) => void>();
  const log = {
    mine: [] as DeviceState[], resting: [] as boolean[], watched: [] as string[][], afterTyping: [] as TypingSignal[], stopped: 0,
  };
  const port: LivePort = {
    setMine: (state) => { log.mine.push(state); },
    setResting: (resting) => { log.resting.push(resting); },
    watch: (ids) => { log.watched.push([...ids]); },
    stateOf: (userId) => states.get(userId) ?? 'offline',
    knowsState: (userId) => knownIds.has(userId),
    subscribeStates: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeTyping: (listener) => {
      typingListeners.add(listener);
      return () => typingListeners.delete(listener);
    },
    afterTypingCall: (signal) => { log.afterTyping.push(signal); },
    stop: () => { log.stopped += 1; },
  };
  return {
    port,
    log,
    setState(userId: string, state: PersonState): void {
      states.set(userId, state);
      knownIds.add(userId);
      stateListeners.forEach((listener) => listener());
    },
    emitTyping(signal: TypingSignal): void {
      typingListeners.forEach((listener) => listener(signal));
    },
  };
}
