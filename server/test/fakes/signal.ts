import type { SignalPort } from '../../core/ports';
import type { ChangeSignal } from '../../core/types';

export type RecordingSignals = SignalPort & { sent: ChangeSignal[] };

/** Records the signals of each save. */
export function recordingSignals(): RecordingSignals {
  const sent: ChangeSignal[] = [];
  return {
    sent,
    async send(_q, signals) {
      sent.push(...signals);
    },
  };
}
