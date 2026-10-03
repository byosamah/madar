import { notBuiltAsync } from './notBuilt';
import type { Deps } from './ports';
import type { RunRequest, RunResult } from './types';

/** Load, run, save (plan 4.5). Track C3 replaces this stub. */
export function runCall(_deps: Deps, _req: RunRequest): Promise<RunResult> {
  return notBuiltAsync('runCall');
}
