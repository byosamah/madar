import type { z } from 'zod';
import { serverContracts } from '../../src/api/contract/server';
import type { AnyCall, ServerHooks } from '../../src/api/registry';
import { sharedCalls } from '../../src/api/sharedCalls';
import { SERVER_CALLS, SERVER_HOOKS } from '../calls/index';
import type { Deps } from './ports';
import type { ServerCallCtx, ServerCallResult } from './types';

/**
 * Every call the server runs, by name (plan 4.5, step 1; task C3): the 116 shared calls of src/api/sharedCalls.ts with their
 * server hooks, and the 9 server calls of server/calls/index.ts with their contracts. A call in SERVER_EXCLUDED is not here, so
 * runCall answers not_found for it.
 *
 * The map is checked when it is built: a name twice, a prototype "prepare" with no server hook (the prototype prepare never runs on
 * the server, so the call would get no prepared value), a hook for a call that is not shared, or a prepare hook on a read call
 * (a read takes no lock) stops the server at start.
 */

type Hooks = ServerHooks<unknown, unknown, Deps>;
type AnyServerCall = (input: never, ctx: ServerCallCtx) => Promise<ServerCallResult<unknown>>;
type Contract = { input: z.ZodType; output: z.ZodType; readOnly: boolean };

export type SharedEntry = { kind: 'shared'; name: string; def: AnyCall; input: z.ZodType; readOnly: boolean; hooks?: Hooks };
export type ServerEntry = {
  kind: 'server'; name: string; call: (input: unknown, ctx: ServerCallCtx) => Promise<ServerCallResult<unknown>>;
  input: z.ZodType; output: z.ZodType; readOnly: boolean;
};
export type CallEntry = SharedEntry | ServerEntry;

export type CallMapParts = {
  shared: Record<string, AnyCall>;
  server: Record<string, AnyServerCall>;
  contracts: Record<string, Contract>;
  hooks: Record<string, Hooks | undefined>;
};

export function buildServerCallMap(parts: CallMapParts): ReadonlyMap<string, CallEntry> {
  const map = new Map<string, CallEntry>();
  for (const [name, def] of Object.entries(parts.shared)) {
    const hooks = parts.hooks[name];
    if (def.prepare && !hooks) throw new Error(`The call ${name} has a prototype prepare and no server hook.`);
    if (def.readOnly && hooks?.prepare) throw new Error(`The read call ${name} has a prepare hook, but a read takes no lock.`);
    map.set(name, { kind: 'shared', name, def, input: def.wire?.input ?? def.input, readOnly: def.readOnly === true, ...(hooks ? { hooks } : {}) });
  }
  for (const name of Object.keys(parts.hooks)) {
    if (!(name in parts.shared)) throw new Error(`The server hook ${name} names no shared call.`);
  }
  for (const [name, call] of Object.entries(parts.server)) {
    if (map.has(name)) throw new Error(`The call ${name} is both a shared call and a server call.`);
    const contract = parts.contracts[name];
    if (!contract) throw new Error(`The server call ${name} has no contract.`);
    map.set(name, { kind: 'server', name, call: call as ServerEntry['call'], input: contract.input, output: contract.output, readOnly: contract.readOnly });
  }
  return map;
}

export const serverCallMap: ReadonlyMap<string, CallEntry> = buildServerCallMap({
  shared: sharedCalls as unknown as Record<string, AnyCall>,
  server: SERVER_CALLS as unknown as Record<string, AnyServerCall>,
  contracts: serverContracts,
  hooks: SERVER_HOOKS as Record<string, Hooks | undefined>,
});
