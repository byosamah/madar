import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import { fakeDeps } from '../test/fakes/deps';
import { call, world } from './bulk.testing';
import { withoutEventBodies } from './run';

/**
 * Lighter write answers (owner, 2026-10-26). In the answer of an agent, an event (an object with a verb) keeps no `before` and no `after`:
 * each held a whole copy of the record. The call output that the screens get does not change, so the raw run below still has both.
 */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

/** The raw output of a call, as the screens get it: runCall on its own office, with no MCP layer. */
async function raw(steps: { name: string; input: Record<string, unknown> }[]): Promise<unknown> {
  const mem = memoryData(seed);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
  const run = createRunCall({ data: () => mem.data() });
  let last: unknown;
  for (const step of steps) {
    const office = await mem.data().office();
    const result = await run(deps, { principal: { userId: 'usr_002' }, name: step.name, input: step.input, batch: { storyRefs: new Map(), office, overviewCalls: 0 } });
    if (!result.ok) throw new Error(`${step.name} failed: ${JSON.stringify(result.error)}`);
    last = result.output;
  }
  return last;
}

/** Every object with a verb in a value, at any depth. */
function eventsIn(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) value.forEach((item) => eventsIn(item, found));
  else if (value && typeof value === 'object') {
    if (typeof (value as { verb?: unknown }).verb === 'string') found.push(value as Record<string, unknown>);
    Object.values(value).forEach((item) => eventsIn(item, found));
  }
  return found;
}

describe('withoutEventBodies', () => {
  it('takes before and after out of an object with a verb, at any depth, and leaves every other object alone', () => {
    const value = { history: [{ event: { id: 'evt_1', verb: 'task.created', before: null, after: { big: 'x' } }, actor: { id: 'usr_1' } }], task: { id: 'tsk_1', before: 'keep', after: 'keep' } };
    expect(withoutEventBodies(value)).toEqual({ history: [{ event: { id: 'evt_1', verb: 'task.created' }, actor: { id: 'usr_1' } }], task: { id: 'tsk_1', before: 'keep', after: 'keep' } });
    expect(withoutEventBodies(null)).toBeNull();
    expect(withoutEventBodies('text')).toBe('text');
  });
});

describe('the MCP answer of a write (owner, 2026-10-26)', () => {
  it('tasks.create: the history event has no before and no after, and the answer is smaller', async () => {
    const input = { projectId: 'prj_001', title: 'Long note', stageId: 'stg_005', ownerId: 'usr_002', description: 'd'.repeat(2000) };
    const w = world(seed, 'usr_002');
    const result = await call(w, 'tasks.create', input);
    expect(result.isError).toBeUndefined();
    const events = eventsIn(result.structuredContent);
    expect(events).toHaveLength(1);
    expect(events[0].verb).toBe('task.created');
    expect(events[0]).not.toHaveProperty('before');
    expect(events[0]).not.toHaveProperty('after');
    // The text block holds the same JSON.
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    const today = JSON.stringify({ output: await raw([{ name: 'tasks.create', input }]) }).length;
    const now = JSON.stringify({ output: result.structuredContent.output }).length;
    // The description stays once in the task itself, so the whole answer is about 60% of the old one, and its history less than a quarter.
    expect(now).toBeLessThan(today * 0.65);
    const history = (output: { history: unknown }) => JSON.stringify(output.history).length;
    expect(history(result.structuredContent.output)).toBeLessThan(history((await raw([{ name: 'tasks.create', input }])) as { history: unknown }) / 4);
  });

  it('tasks.update of a long description: the answer is less than half of the old one', async () => {
    const first = { id: 'tsk_011', patch: { description: 'a'.repeat(2000) } };
    const second = { id: 'tsk_011', patch: { description: 'b'.repeat(2000) } };
    const w = world(seed, 'usr_002');
    expect((await call(w, 'tasks.update', first)).isError).toBeUndefined();
    const result = await call(w, 'tasks.update', second);
    expect(result.isError).toBeUndefined();
    for (const event of eventsIn(result.structuredContent)) {
      expect(event, String(event.verb)).not.toHaveProperty('before');
      expect(event, String(event.verb)).not.toHaveProperty('after');
    }
    const today = JSON.stringify({ output: await raw([{ name: 'tasks.update', input: first }, { name: 'tasks.update', input: second }]) }).length;
    const now = JSON.stringify({ output: result.structuredContent.output }).length;
    expect(now).toBeLessThan(today / 2);
  });

  it('the screens keep the full event: the raw call output still has before and after', async () => {
    const output = await raw([{ name: 'tasks.create', input: { projectId: 'prj_001', title: 'Raw', stageId: 'stg_005', ownerId: 'usr_002' } }]);
    const [event] = eventsIn(output);
    expect(event).toHaveProperty('before');
    expect(event).toHaveProperty('after');
  });

  it('events.list gives events with no before and no after too', async () => {
    const w = world(seed, 'usr_002');
    await call(w, 'tasks.update', { id: 'tsk_011', patch: { flagged: true } });
    const list = await call(w, 'events.list', { projectId: 'prj_001', limit: 5 });
    const events = eventsIn(list.structuredContent);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(Object.keys(event)).not.toEqual(expect.arrayContaining(['before']));
    expect(events.some((event) => 'after' in event)).toBe(false);
  });
});
