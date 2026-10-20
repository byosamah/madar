import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * The signal of chats.setNotify (chat design item 21). The choice is the own read mark of one person: the call writes no event, and
 * its only signal goes to that person, with no office signal.
 */

// usage.get is not built here (as in chatsArchiveSignal.test.ts). serverCallMap.ts copies each call at import, so the mock comes first.
vi.mock('../calls/usage', async () => {
  const { notBuiltAsync } = await import('./notBuilt');
  return { usageGet: () => notBuiltAsync('usage.get'), usageRetryEffect: () => notBuiltAsync('usage.retryEffect') };
});

const NOW = new Date('2026-10-04T06:00:00Z');

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

describe('chats.setNotify, the signal of the call', () => {
  it('sends only a person signal to the actor, and writes no event', async () => {
    const office = structuredClone(seed);
    const mem = memoryData(office);
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(NOW);
    const run = createRunCall({ data: () => mem.data() });
    const eventsBefore = Object.keys(mem.tables.state.events).length;
    const result = await run(deps, {
      principal: { userId: 'usr_001' },
      name: 'chats.setNotify',
      input: { conversationId: 'cnv_001', notify: 'all' },
      batch: { storyRefs: new Map(), overviewCalls: 0 },
    });
    if (!result.ok) throw new Error(`call failed: ${result.error.message}`);
    expect(result.output).toEqual({ notify: 'all' });
    const signals = result.signals ?? [];
    expect(signals).toHaveLength(1);
    expect(signals[0].office).toBe(false);
    expect(signals[0].kinds).toEqual(['chatReads']);
    expect(signals[0].channel).toBe('person:usr_001');
    expect(Object.keys(mem.tables.state.events)).toHaveLength(eventsBefore);
  });
});
