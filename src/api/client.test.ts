import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApi } from './client';
import { defineCall } from './registry';
import { invalid } from './errors';
import { writeEvent } from './events';
import { Store } from './store';
import { memoryPersister } from './persist';
import { makeWorld } from '../test/factories';

const echo = defineCall({
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ text: z.string(), actor: z.string() }),
  readOnly: true,
  run: (input, ctx) => ({ text: input.text, actor: ctx.actor.id }),
});
const bump = defineCall({
  input: z.object({ by: z.number().int() }),
  output: z.object({ limit: z.number() }),
  run(input, ctx) {
    ctx.state.settings.workloadLimit += input.by;
    if (ctx.state.settings.workloadLimit > 50) throw invalid('by', 'The limit is too high.');
    return { limit: ctx.state.settings.workloadLimit };
  },
});
const settings = defineCall({
  input: z.object({}),
  output: z.object({ workloadLimit: z.number(), codePrefix: z.string(), defaultStages: z.array(z.string()) }),
  readOnly: true,
  run: (_input, ctx) => ctx.state.settings,
});
const prepared = defineCall({
  input: z.object({}),
  output: z.object({ got: z.string() }),
  prepare: async () => 'from prepare',
  run: (_input, _ctx, value) => ({ got: value }),
});
const ping = defineCall({ input: z.object({}), output: z.object({ ok: z.boolean() }), prototypeOnly: true, run: () => ({ ok: true }) });
const whoami = defineCall({
  input: z.object({}),
  output: z.object({ actor: z.string(), authority: z.string(), correlationId: z.string() }),
  readOnly: true,
  run: (_input, ctx) => ({ actor: ctx.actor.id, authority: ctx.authority.id, correlationId: ctx.correlationId }),
});
const breaker = defineCall({
  input: z.object({}),
  output: z.object({ limit: z.number() }),
  run(_input, ctx) {
    ctx.state.settings.workloadLimit = 99;
    return { limit: 'many' } as unknown as { limit: number };
  },
});
const logged = defineCall({
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  run(_input, ctx) {
    writeEvent(ctx, { projectId: null, verb: 'settings.updated', targetType: 'settings', targetId: 'office', before: null, after: null });
    return { ok: true };
  },
});
const CALLS = { 'test.logged': logged, 'test.breaker': breaker, 'test.echo': echo, 'test.bump': bump, 'test.settings': settings, 'test.prepared': prepared, 'test.whoami': whoami, 'session.ping': ping };

let store: Store;
beforeEach(() => {
  store = new Store(makeWorld(), memoryPersister());
});
const apiWith = (failureRate = 0) => createApi(CALLS, { store, latencyMs: 0, failureRate: () => failureRate });

describe('createApi', () => {
  it('passes the current user to the call', async () => {
    expect(await apiWith().call('test.echo', { text: 'hi' })).toEqual({ text: 'hi', actor: 'usr_001' });
  });

  it('rejects bad input with the field names', async () => {
    await expect(apiWith().call('test.echo', { text: '' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['text'] } });
  });

  it('rolls back a call that fails', async () => {
    await expect(apiWith().call('test.bump', { by: 100 })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(store.state.settings.workloadLimit).toBe(10);
    expect(await apiWith().call('test.bump', { by: 2 })).toEqual({ limit: 12 });
  });

  it('returns a copy, not the live state', async () => {
    const out = await apiWith().call('test.settings', {});
    out.workloadLimit = 99;
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('passes the prepared value to run', async () => {
    expect(await apiWith().call('test.prepared', {})).toEqual({ got: 'from prepare' });
  });

  it('fails calls on purpose when errors are simulated, except session calls', async () => {
    await expect(apiWith(1).call('test.echo', { text: 'x' })).rejects.toMatchObject({ code: 'failed' });
    await expect(apiWith(1).call('session.ping', {})).resolves.toEqual({ ok: true });
  });

  it('refuses a call with no current user', async () => {
    store.state.session.currentUserId = 'usr_404';
    await expect(apiWith().call('test.echo', { text: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an unknown call', async () => {
    await expect(apiWith().call('test.missing' as never, {} as never)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not tell listeners about reads', async () => {
    let changes = 0;
    store.subscribe(() => {
      changes += 1;
    });
    await apiWith().call('test.echo', { text: 'x' });
    expect(changes).toBe(0);
    await apiWith().call('test.bump', { by: 1 });
    expect(changes).toBe(1);
  });

  it('runs an agent with the rights of the person it acts for', async () => {
    store.state.session.currentUserId = 'usr_005';
    expect(await apiWith().call('test.whoami', {})).toMatchObject({ actor: 'usr_005', authority: 'usr_003' });
  });

  it('refuses an agent whose person is not active', async () => {
    store.state.session.currentUserId = 'usr_005';
    store.state.users.usr_003.active = false;
    await expect(apiWith().call('test.whoami', {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps one story id when the caller passes it, and makes a new one otherwise', async () => {
    const api = apiWith();
    expect((await api.call('test.whoami', {}, { correlationId: 'cor_weekly' })).correlationId).toBe('cor_weekly');
    const a = await api.call('test.whoami', {});
    const b = await api.call('test.whoami', {});
    expect(a.correlationId).not.toBe(b.correlationId);
  });

  it('refuses a bad story id and changes nothing', async () => {
    await expect(apiWith().call('test.bump', { by: 1 }, { correlationId: '' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['correlationId'] },
    });
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('rolls back a call whose output has the wrong shape', async () => {
    await expect(apiWith().call('test.breaker', {})).rejects.toMatchObject({ code: 'failed' });
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('lets session calls run for an agent whose person is not active', async () => {
    store.state.session.currentUserId = 'usr_005';
    store.state.users.usr_003.active = false;
    await expect(apiWith().call('session.ping', {})).resolves.toEqual({ ok: true });
  });

  it('runs a call and returns its story ID and whether it changed a record', async () => {
    const result = await apiWith().run('test.logged', {}, { correlationId: 'cor_ui_one' });
    expect(result).toEqual({ output: { ok: true }, storyId: 'cor_ui_one', changed: true });
  });

  it('makes a story ID when the caller passes none, and uses the same ID for the events', async () => {
    const result = await apiWith().run('test.logged', {});
    expect(result.storyId).toMatch(/^cor_/);
    expect(Object.values(store.state.events).map((event) => event.correlationId)).toEqual([result.storyId]);
  });

  it('reports no change for a read, and for a write that records no event', async () => {
    expect(await apiWith().run('test.echo', { text: 'x' })).toMatchObject({ output: { text: 'x' }, changed: false });
    expect(await apiWith().run('test.bump', { by: 1 })).toMatchObject({ output: { limit: 11 }, changed: false });
  });

  it('counts only the events of this call when the story already has events', async () => {
    const api = apiWith();
    await api.run('test.logged', {}, { correlationId: 'cor_ui_two' });
    expect((await api.run('test.bump', { by: 1 }, { correlationId: 'cor_ui_two' })).changed).toBe(false);
    expect((await api.run('test.logged', {}, { correlationId: 'cor_ui_two' })).changed).toBe(true);
  });

  it('accepts an idempotency key in the meta, and refuses an empty one', async () => {
    await expect(apiWith().run('test.logged', {}, { key: 'k-1' })).resolves.toMatchObject({ changed: true });
    await expect(apiWith().call('test.logged', {}, { key: '' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['key'] } });
  });

  it('gives run() the same errors as call()', async () => {
    await expect(apiWith().run('test.echo', { text: '' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(apiWith(1).run('test.echo', { text: 'x' })).rejects.toMatchObject({ code: 'failed' });
  });
});
