import type { MeterPort } from '../core/ports';

/**
 * The usage meter (plan 5.8). This default does nothing, so the batch route and the loaders can call it before track M fills it.
 * It is the one stub that does not refuse: a refusal here would fail every batch.
 */
export function meterPort(): MeterPort {
  return {
    addBytes: () => undefined,
    countRequest: async () => undefined,
    signalsFailed: () => undefined,
  };
}
