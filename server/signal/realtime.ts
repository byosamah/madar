import { notBuiltAsync } from '../core/notBuilt';
import type { SignalPort } from '../core/ports';

/** One realtime.send for each signal, inside the save transaction (plan 5.3). Track N1 replaces this stub. */
export const realtimeSignalPort: SignalPort = {
  send: () => notBuiltAsync('The Realtime sender'),
};
