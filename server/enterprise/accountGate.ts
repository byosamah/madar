import { ApiError } from '../../src/api/errors';
import type { RunError } from '../core/types';
import { runErrorOf } from '../http/errors';
import { utcDay } from '../mail/quota';
import { ENT_VADO, type EnterpriseId } from './ids';
import type { PlatformStub } from './platform/stub';

/**
 * The account gate of the Worker (Madar enterprises, plan C, design 5.14). When the account reaches 90 percent of a free day limit, every
 * enterprise except ENT_VADO gets the calm busy answer for the rest of the UTC day. The Worker asks the platform object (capState) and keeps
 * the answer for 60 seconds in the isolate, so most requests read nothing. ENT_VADO passes always. A platform call that throws lets the call
 * through (fail open): the cap must never be the reason that the office stops. The Worker uses the gate in batch and mcp only, never in the
 * sign-in steps, forgot and renew.
 *
 * The file is named accountGate.ts because server/enterprise/gate.ts is the identity gate of an object (EnterpriseGate).
 */

export const ACCOUNT_BUSY = new ApiError('failed', 'Madar is busy today. It works again at 03:00 Riyadh.', { reason: 'busy' });
export const ACCOUNT_GATE_TTL_MS = 60_000;

type State = { stop: boolean; writesStop: boolean };

export function accountGate<E>(o: { platform: (env: E) => Pick<PlatformStub, 'capState'>; now(): Date; ttlMs?: number }) {
  const ttl = o.ttlMs ?? ACCOUNT_GATE_TTL_MS;
  let held: { at: number; day: string; state: State } | undefined;

  return async (env: E, ent: EnterpriseId, writes: boolean): Promise<RunError | undefined> => {
    if (ent === ENT_VADO) return undefined;
    const now = o.now();
    const day = utcDay(now);
    if (!held || held.day !== day || now.getTime() - held.at >= ttl) {
      try {
        held = { at: now.getTime(), day, state: await o.platform(env).capState({ day }) };
      } catch {
        return undefined;
      }
    }
    return held.state.stop || (writes && held.state.writesStop) ? runErrorOf(ACCOUNT_BUSY) : undefined;
  };
}
