import type { Deps } from '../../core/ports';
import { checkLimits } from '../../usage/warn';

/** Step 6 of the 15-minute job (plan 5.5, 5.8): the 80% warning of track M, once for each meter and month. */
export async function usage(deps: Deps): Promise<{ warned: string[] }> {
  const { warned } = await checkLimits(deps);
  return { warned };
}
