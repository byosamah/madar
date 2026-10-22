import type { TypingSignal } from '../../api/remote/wire';

/**
 * The live port (chat presence design, "One port"): the screens read who is here and who types through this one interface. The
 * adapters of the track live fill it (the prototype, Supabase, the office socket). The shape is fixed after wave 1.
 */
export type PersonState = 'online' | 'away' | 'offline';
/** The state of one device: a device with Madar open is Online or Away, and a closed one is not there. */
export type DeviceState = 'online' | 'away';

export type LivePort = {
  /** This device; the port sends it when it changes. */
  setMine(state: DeviceState): void;
  /** A resting device leaves every status topic, so it sends and receives nothing; waking joins and tracks again. */
  setResting(resting: boolean): void;
  /** The active humans whose states the screens show. */
  watch(userIds: readonly string[]): void;
  stateOf(userId: string): PersonState;
  /**
   * True when stateOf(userId) is a state that the port has read (a topic that synced, or the first snapshot of the office socket), not
   * the Offline of a person it cannot see yet. A port without it never says so, and the typing sender then always sends (DF-10).
   */
  knowsState?(userId: string): boolean;
  subscribeStates(listener: () => void): () => void;
  subscribeTyping(listener: (signal: TypingSignal) => void): () => void;
  /** The prototype only: hands a typing signal that the server call accepted to the other tabs. */
  afterTypingCall?(signal: TypingSignal): void;
  stop(): void;
};

/** The state of a person from the states of the devices: any Online device makes Online, any open device makes Away, none makes Offline. */
export function combineStates(devices: readonly DeviceState[]): PersonState {
  if (devices.includes('online')) return 'online';
  return devices.length > 0 ? 'away' : 'offline';
}
