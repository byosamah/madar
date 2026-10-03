import type { z } from 'zod';
import type { User } from './contract/entities';
import type { Persister } from './persist';
import type { State } from './store';

/** "actor" is who acts (a person or an agent). "authority" is whose rights apply: the person, or the person an agent acts for (spec 17). */
export type Ctx = {
  state: State; actor: User; authority: User; correlationId: string; stamp: string; today: string; now: Date; persistent: boolean;
};
export type PrepareCtx = {
  state: State; persister: Persister; actor: User; now: Date;
  /** The real build: the stored data keys of this list that another record still uses. "after" keeps those (plan 4.13, A2). */
  blobKeysInUse?(keys: string[]): Promise<Set<string>>;
};

/** One API call. "run" must be synchronous. Only "prepare" may wait, for example for file data. */
export interface CallDef<I extends z.ZodType, O extends z.ZodType, P = undefined> {
  input: I;
  output: O;
  readOnly?: boolean;
  /** A control of the prototype itself (who you preview as, sample data). It runs for any current user and stays out of the agent contract. */
  prototypeOnly?: boolean;
  /**
   * The form on the wire, when it differs from the form the screens pass (plan 4.5, step 2).
   * Example: files.upload takes a blob in the prototype and an uploadId on the server.
   */
  wire?: { input?: z.ZodType; output?: z.ZodType };
  prepare?(input: z.output<I>, ctx: PrepareCtx): Promise<P>;
  run(input: z.output<I>, ctx: Ctx, prepared: P): z.input<O>;
  /** Work outside the state after the change is made, for example removing stored file data. It may wait. A failure here does not fail the call. */
  after?(output: z.output<O>, ctx: PrepareCtx, prepared: P): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCall = CallDef<z.ZodType, z.ZodType, any>;

export function defineCall<I extends z.ZodType, O extends z.ZodType, P = undefined>(def: CallDef<I, O, P>): CallDef<I, O, P> {
  return def;
}

/**
 * The server hooks of a call (plan 4.5, steps 5.1 and 5.5). They live in server/, never here, because src/api never imports server code.
 * The server keeps them in its own map by call name; the prototype uses "prepare" above instead.
 * D is the server's dependencies (ports, config), which only the server knows.
 */
export type HookQuery = <R = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<R[]>;
export type HookCtx<D> = { actorId: string; now: Date; deps: D };
export interface ServerHooks<I = unknown, P = unknown, D = unknown> {
  /** Before the office lock: network work (object checks, copies) and single read statements. It never holds the lock. */
  preflight?(input: I, ctx: HookCtx<D>): Promise<unknown>;
  /** Inside the lock, SQL only. Its value reaches run() as "prepared". */
  prepare?(input: I, ctx: HookCtx<D> & { q: HookQuery }, preflight: unknown): Promise<P>;
}
