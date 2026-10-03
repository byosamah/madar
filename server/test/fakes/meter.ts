import type { MeterPort } from '../../core/ports';

export type RecordingMeter = MeterPort & { bytes: number; requests: number };

/** Counts what the loaders read and the batches the routes finish. */
export function recordingMeter(): RecordingMeter {
  const meter: RecordingMeter = {
    bytes: 0,
    requests: 0,
    addBytes(n) {
      meter.bytes += n;
    },
    async countRequest() {
      meter.requests += 1;
    },
  };
  return meter;
}
