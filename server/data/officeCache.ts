import { notBuiltAsync } from '../core/notBuilt';
import type { Deps, Query } from '../core/ports';
import type { OfficeSnapshot } from '../core/types';

/**
 * The office lists in module memory, at the office_meta.version it read (plan 4.7). Track C2 replaces this stub.
 * q: read inside a transaction that is open (runCall). Without q, one read of its own, for example the sign-in lookup of the batch route (E3).
 */
export function readOffice(_deps: Deps, _q?: Query): Promise<OfficeSnapshot> {
  return notBuiltAsync('The office cache');
}
