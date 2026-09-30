import type { z } from 'zod';
import type { User } from './contract/entities';
import type { Persister } from './persist';
import type { State } from './store';

/** "actor" is who acts (a person or an agent). "authority" is whose rights apply: the person, or the person an agent acts for (spec 17). */
export type Ctx = {
  state: State; actor: User; authority: User; correlationId: string; stamp: string; today: string; now: Date; persistent: boolean;
};
export type PrepareCtx = { state: State; persister: Persister; actor: User; now: Date };

/** One API call. "run" must be synchronous. Only "prepare" may wait, for example for file data. */
export interface CallDef<I extends z.ZodType, O extends z.ZodType, P = undefined> {
  input: I;
  output: O;
  readOnly?: boolean;
  prepare?(input: z.output<I>, ctx: PrepareCtx): Promise<P>;
  run(input: z.output<I>, ctx: Ctx, prepared: P): z.input<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCall = CallDef<z.ZodType, z.ZodType, any>;

export function defineCall<I extends z.ZodType, O extends z.ZodType, P = undefined>(def: CallDef<I, O, P>): CallDef<I, O, P> {
  return def;
}
