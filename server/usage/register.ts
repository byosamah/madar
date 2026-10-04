import { registerEffect } from '../core/effects';
import { LIMIT_WARNING_EFFECT, sendLimitWarning } from './warn';

/**
 * Wires the usage effect into the outbox (plan 4.12; task M1): the handler of usage.limitWarning. The result removes it (for
 * tests). server/usage/effects.ts calls it once for the entries.
 */
export function registerUsageEffects(): () => void {
  return registerEffect(LIMIT_WARNING_EFFECT, sendLimitWarning);
}
