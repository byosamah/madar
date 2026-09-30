import { z } from 'zod';
import { ApiError } from './errors';
import type { AnyCall } from './registry';
import type { State, Store } from './store';
import { now as clockNow, nowStamp, todayISO } from '../lib/dates';

export type CallMap = Record<string, AnyCall>;

/** One story ID for several calls, so one agent request reads as one story in the log. */
export type CallMeta = { correlationId?: string };

export type Api<M extends CallMap> = {
  call<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta?: CallMeta): Promise<z.output<M[N]['output']>>;
};

const Meta = z.object({ correlationId: z.string().min(1).max(80).optional() });

function invalidInput(error: z.ZodError): ApiError {
  const issues = error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
  return new ApiError('invalid_input', 'Some fields are not valid.', { fields: [...new Set(issues.map((i) => i.path))], issues });
}

export type ApiOptions = {
  store: Store;
  latencyMs?: number;
  failureRate?: () => number;
  random?: () => number;
};

export function createApi<M extends CallMap>(calls: M, options: ApiOptions): Api<M> {
  const { store, latencyMs = 120, failureRate = () => 0, random = Math.random } = options;
  return {
    async call<N extends keyof M & string>(name: N, rawInput: z.input<M[N]['input']>, meta: CallMeta = {}): Promise<z.output<M[N]['output']>> {
      const def: AnyCall | undefined = calls[name];
      if (!def) throw new ApiError('not_found', `There is no call named ${name}.`);
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (!def.prototypeOnly && random() < failureRate()) throw new ApiError('failed', 'The call failed. Try again.');
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) throw invalidInput(parsed.error);
      const parsedMeta = Meta.safeParse(meta);
      if (!parsedMeta.success) throw invalidInput(parsedMeta.error);
      const actorId = store.state.session.currentUserId;
      const actor = store.state.users[actorId];
      if (!actor) throw new ApiError('forbidden', 'There is no current user.');
      // An agent acts with the rights of its person, never with rights of its own (spec 17).
      // Prototype controls still run, so the viewer can always switch away from an agent that cannot act.
      let authority = actor;
      if (actor.kind === 'agent') {
        const owner = actor.ownerId ? store.state.users[actor.ownerId] : undefined;
        const ownerActs = owner !== undefined && owner.kind === 'human' && owner.active;
        if (ownerActs) authority = owner;
        else if (!def.prototypeOnly) throw new ApiError('forbidden', 'This agent has no active person to act for.');
      }
      const correlationId = parsedMeta.data.correlationId ?? `cor_${Date.now().toString(36)}${random().toString(36).slice(2, 8)}`;
      const at = clockNow();
      const prepared = def.prepare
        ? await def.prepare(parsed.data, { state: store.state, persister: store.persister, actor, now: at })
        : undefined;
      // The output is checked inside the change, so a wrong shape rolls the change back.
      const execute = (state: State) => {
        const result = def.run(parsed.data, {
          state, actor: state.users[actorId], authority: state.users[authority.id], correlationId,
          stamp: nowStamp(at), today: todayISO(at), now: at, persistent: store.persistent,
        }, prepared);
        const output = def.output.safeParse(result);
        if (!output.success) throw new ApiError('failed', `The call ${name} returned data in the wrong shape.`, { issues: output.error.issues.length });
        return output.data;
      };
      return (def.readOnly ? store.read(execute) : store.run(execute)) as z.output<M[N]['output']>;
    },
  };
}
