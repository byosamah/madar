import type { Deps } from '../../core/ports';
import { releaseHeld, type HeldReport } from '../../push/held';

/**
 * Step 4 of the 15-minute job (owner, 2026-10-22, fbk_048): the quiet end. A person whose push was held back in quiet hours gets ONE push
 * when the quiet hours are over (server/push/held.ts). A run with nothing held reads one statement and sends nothing.
 */
export async function quietEnd(deps: Deps, at: Date): Promise<HeldReport> {
  return releaseHeld(deps, at);
}
