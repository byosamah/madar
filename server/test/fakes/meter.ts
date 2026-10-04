import type { MeterPort } from '../../core/ports';

export type RecordingMeter = MeterPort & { bytes: number; requests: number; failedSignals: number };

/** Counts what the loaders read, the batches the routes finish, and the change signals that were not sent. */
export function recordingMeter(): RecordingMeter {
  const meter: RecordingMeter = {
    bytes: 0,
    requests: 0,
    failedSignals: 0,
    addBytes(n) {
      meter.bytes += n;
    },
    async countRequest() {
      meter.requests += 1;
    },
    signalsFailed(count) {
      meter.failedSignals += count;
    },
  };
  return meter;
}
