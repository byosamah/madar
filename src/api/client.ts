import { z } from 'zod';
import { ApiError } from './errors';
import { executeParsed, resolveAuthority } from './execute';
import type { AnyCall, PrepareCtx } from './registry';
import type { State, Store } from './store';
import { now as clockNow } from '../lib/dates';

export type CallMap = Record<string, AnyCall>;

/**
 * One story ID for several calls, so one agent request reads as one story in the log.
 * "key" is the idempotency key of a write in the real build: only a Retry sends the same key again (plan 4.10). The fake API ignores it.
 */
export type CallMeta = { correlationId?: string; key?: string };

/** The output, plus the story ID that the call used and whether it changed a record. Only useUndoable needs it. */
export type CallResult<O> = { output: O; storyId: string; changed: boolean };

export type Api<M extends CallMap> = {
  call<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta?: CallMeta): Promise<z.output<M[N]['output']>>;
  run<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta?: CallMeta): Promise<CallResult<z.output<M[N]['output']>>>;
};

const Meta = z.object({ correlationId: z.string().min(1).max(80).optional(), key: z.string().min(1).max(100).optional() });

export function invalidInput(error: z.ZodError): ApiError {
  const issues = error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
  return new ApiError('invalid_input', 'Some fields are not valid.', { fields: [...new Set(issues.map((i) => i.path))], issues });
}

export type ApiOptions = {
  store: Store;
  latencyMs?: number;
  failureRate?: () => number;
  random?: () => number;
  /** The prototype: the sample office for session.resetSampleData (src/data/sampleOffice.ts). */
  sampleOffice?: PrepareCtx['sampleOffice'];
};

function storyEvents(state: State, storyId: string): number {
  let n = 0;
  for (const event of Object.values(state.events)) if (event.correlationId === storyId) n += 1;
  return n;
}

export function createApi<M extends CallMap>(calls: M, options: ApiOptions): Api<M> {
  const { store, latencyMs = 120, failureRate = () => 0, random = Math.random, sampleOffice } = options;

  // call() returns this function's promise without an extra await, so it resolves on the same tick as before
  // (screen tests depend on that order).
  async function invoke(name: string, rawInput: unknown, meta: CallMeta): Promise<unknown> {
    const def: AnyCall | undefined = calls[name];
    if (!def) throw new ApiError('not_found', `There is no call named ${name}.`);
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (!def.prototypeOnly && random() < failureRate()) throw new ApiError('failed', 'The call failed. Try again.');
    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) throw invalidInput(parsed.error);
    const parsedMeta = Meta.safeParse(meta);
    if (!parsedMeta.success) throw invalidInput(parsedMeta.error);
    const actorId = store.state.session.currentUserId;
    const { actor, authority } = resolveAuthority(store.state, actorId, def);
    const correlationId = parsedMeta.data.correlationId ?? newCorrelationId();
    const at = clockNow();
    const prepared = def.prepare
      ? await def.prepare(parsed.data, { state: store.state, persister: store.persister, actor, now: at, sampleOffice })
      : undefined;
    const base = { actorId, authorityId: authority.id, correlationId, now: at, persistent: store.persistent };
    const execute = (state: State) => executeParsed(def, name, parsed.data, state, base, prepared);
    const output = def.readOnly ? store.read(execute) : store.run(execute);
    // Work outside the state (removing stored file data) waits until the change is saved, so a closed tab never keeps a record
    // whose data is gone (review 2026-10-03).
    if (def.after) {
      await store.flush();
      await def.after(output, { state: store.state, persister: store.persister, actor, now: at }, prepared).catch(() => undefined);
    }
    return output;
  }

  function newCorrelationId(): string {
    return `cor_${Date.now().toString(36)}${random().toString(36).slice(2, 8)}`;
  }

  const api: Api<M> = {
    call<N extends keyof M & string>(name: N, rawInput: z.input<M[N]['input']>, meta: CallMeta = {}): Promise<z.output<M[N]['output']>> {
      return invoke(name, rawInput, meta) as Promise<z.output<M[N]['output']>>;
    },
    // run() goes through api.call, so a test that stands in for call() (a failure, a record of the calls) also covers run().
    // "changed": the call wrote at least one event under its story.
    async run<N extends keyof M & string>(name: N, rawInput: z.input<M[N]['input']>, meta: CallMeta = {}): Promise<CallResult<z.output<M[N]['output']>>> {
      const storyId = meta.correlationId ?? newCorrelationId();
      const write = calls[name] !== undefined && !calls[name].readOnly;
      const before = write ? storyEvents(store.state, storyId) : 0;
      const output = await api.call(name, rawInput, { ...meta, correlationId: storyId });
      return { output, storyId, changed: write && storyEvents(store.state, storyId) > before };
    },
  };
  return api;
}
