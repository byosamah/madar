import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCall } from './registry';
import { executeParsed, resolveAuthority } from './execute';
import { makeWorld } from '../test/factories';

const whoami = defineCall({
  input: z.object({}),
  output: z.object({ actor: z.string(), authority: z.string(), story: z.string(), got: z.string() }),
  run: (_input, ctx, prepared: string) => ({ actor: ctx.actor.id, authority: ctx.authority.id, story: ctx.correlationId, got: prepared }),
});
const control = defineCall({ input: z.object({}), output: z.object({}), prototypeOnly: true, run: () => ({}) });
const wrongShape = defineCall({
  input: z.object({}),
  output: z.object({ n: z.number() }),
  run: () => ({ n: 'many' }) as unknown as { n: number },
});
const at = new Date('2026-09-30T06:00:00Z');

describe('resolveAuthority', () => {
  it('gives a person their own rights', () => {
    const state = makeWorld();
    const { actor, authority } = resolveAuthority(state, 'usr_002', whoami);
    expect([actor.id, authority.id]).toEqual(['usr_002', 'usr_002']);
  });

  it('gives an agent the rights of its active person', () => {
    const state = makeWorld();
    const { actor, authority } = resolveAuthority(state, 'usr_005', whoami);
    expect([actor.id, authority.id]).toEqual(['usr_005', 'usr_003']);
  });

  it('refuses an unknown person', () => {
    expect(() => resolveAuthority(makeWorld(), 'usr_404', whoami)).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('refuses an agent whose person is off, except for a prototype control', () => {
    const state = makeWorld();
    state.users.usr_003.active = false;
    expect(() => resolveAuthority(state, 'usr_005', whoami)).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(resolveAuthority(state, 'usr_005', control).authority.id).toBe('usr_005');
  });
});

describe('executeParsed', () => {
  it('runs the call with the actor, the authority, the story and the prepared value', () => {
    const state = makeWorld();
    const output = executeParsed(whoami, 'test.whoami', {}, state, { actorId: 'usr_005', authorityId: 'usr_003', correlationId: 'cor_x', now: at, persistent: true }, 'ready');
    expect(output).toEqual({ actor: 'usr_005', authority: 'usr_003', story: 'cor_x', got: 'ready' });
  });

  it('refuses an output of the wrong shape with failed', () => {
    const state = makeWorld();
    expect(() => executeParsed(wrongShape, 'test.wrong', {}, state, { actorId: 'usr_001', authorityId: 'usr_001', correlationId: 'cor_x', now: at, persistent: true }, undefined))
      .toThrow(expect.objectContaining({ code: 'failed' }));
  });

  it('checks the wire output on the server, when the call has one', () => {
    const linked = defineCall({
      input: z.object({}),
      output: z.object({ blob: z.instanceof(Blob) }),
      wire: { output: z.object({ url: z.string() }) },
      run: () => ({ url: 'https://files.example/x' }) as unknown as { blob: Blob },
    });
    const base = { actorId: 'usr_001', authorityId: 'usr_001', correlationId: 'cor_x', now: at, persistent: true };
    expect(executeParsed(linked, 'test.linked', {}, makeWorld(), { ...base, wireOutput: true }, undefined)).toEqual({ url: 'https://files.example/x' });
    expect(() => executeParsed(linked, 'test.linked', {}, makeWorld(), base, undefined)).toThrow(expect.objectContaining({ code: 'failed' }));
    expect(executeParsed(whoami, 'test.whoami', {}, makeWorld(), { ...base, wireOutput: true }, 'p')).toMatchObject({ got: 'p' });
  });
});

