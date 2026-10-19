import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { SERVER_CALL_NAMES, serverContracts } from '../../src/api/contract/server';
import { defineCall, type AnyCall } from '../../src/api/registry';
import { SERVER_EXCLUDED, sharedCalls } from '../../src/api/sharedCalls';
import { SERVER_CALLS, SERVER_HOOKS } from '../calls/index';
import { buildServerCallMap, serverCallMap } from './serverCallMap';

const run = () => ({});
const plain = defineCall({ input: z.object({}), output: z.object({}), run });
const withPrepare = defineCall({ input: z.object({}), output: z.object({}), prepare: async () => undefined, run });
const reader = defineCall({ input: z.object({}), output: z.object({}), readOnly: true, run });

describe('serverCallMap (plan 4.5, step 1)', () => {
  it('holds the 142 shared calls and the 15 server calls, and no call that the server leaves out', () => {
    expect(serverCallMap.size).toBe(157);
    expect([...serverCallMap.keys()].sort()).toEqual([...Object.keys(sharedCalls), ...SERVER_CALL_NAMES].sort());
    for (const name of SERVER_EXCLUDED) expect(serverCallMap.has(name), name).toBe(false);
  });

  it('gives each shared call its wire input, its server hooks, and its read flag', () => {
    const upload = serverCallMap.get('files.upload')!;
    expect(upload.kind).toBe('shared');
    if (upload.kind !== 'shared') return;
    expect(upload.input).toBe(sharedCalls['files.upload'].wire?.input);
    expect(upload.hooks).toBe(SERVER_HOOKS['files.upload']);
    const list = serverCallMap.get('tasks.list')!;
    expect([list.readOnly, list.input]).toEqual([true, sharedCalls['tasks.list'].input]);
  });

  it('gives each server call its contract and its function', () => {
    for (const name of SERVER_CALL_NAMES) {
      const entry = serverCallMap.get(name)!;
      expect(entry.kind, name).toBe('server');
      if (entry.kind !== 'server') continue;
      expect(entry.call).toBe(SERVER_CALLS[name]);
      expect([entry.input, entry.output, entry.readOnly]).toEqual([serverContracts[name].input, serverContracts[name].output, serverContracts[name].readOnly]);
    }
  });

  it('gives a server hook to every shared call that has a prototype prepare, since the prototype prepare never runs on the server', () => {
    for (const [name, def] of Object.entries(sharedCalls) as [string, AnyCall][]) {
      if (def.prepare) expect(SERVER_HOOKS[name as keyof typeof SERVER_HOOKS], name).toBeDefined();
    }
  });

  it('refuses a map with a name twice, a prototype prepare without a server hook, a hook of an unknown call, and a prepare hook on a read', () => {
    const contract = serverContracts['story.start'];
    expect(() => buildServerCallMap({ shared: { 'story.start': plain }, server: { 'story.start': async () => ({ output: {} }) }, contracts: { 'story.start': contract }, hooks: {} }))
      .toThrow(/story.start/);
    expect(() => buildServerCallMap({ shared: { 'a.b': withPrepare }, server: {}, contracts: {}, hooks: {} })).toThrow(/a.b/);
    expect(() => buildServerCallMap({ shared: { 'a.b': plain }, server: {}, contracts: {}, hooks: { 'a.c': { preflight: async () => 1 } } })).toThrow(/a.c/);
    expect(() => buildServerCallMap({ shared: { 'a.r': reader }, server: {}, contracts: {}, hooks: { 'a.r': { prepare: async () => 1 } } })).toThrow(/a.r/);
    expect(buildServerCallMap({ shared: { 'a.b': withPrepare }, server: {}, contracts: {}, hooks: { 'a.b': { preflight: async () => 1 } } }).size).toBe(1);
  });
});
