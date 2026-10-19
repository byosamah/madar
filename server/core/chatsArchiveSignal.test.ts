import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * The signal of chats.archive. The call writes no event. Its only signal goes to the person who archived the chat: no office
 * signal, and the kind of the person's own read marks.
 */

// usage.get is not built here (as in writeKinds.test.ts). serverCallMap.ts copies each call at import, so the mock comes first.
vi.mock('../calls/usage', async () => {
  const { notBuiltAsync } = await import('./notBuilt');
  return { usageGet: () => notBuiltAsync('usage.get'), usageRetryEffect: () => notBuiltAsync('usage.retryEffect') };
});

const NOW = new Date('2026-10-04T06:00:00Z');

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

describe('chats.archive, the signal of the call', () => {
  it('sends only a person signal to the actor, and writes no event', async () => {
    const office = structuredClone(seed);
    const mem = memoryData(office);
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(NOW);
    const run = createRunCall({ data: () => mem.data() });
    const eventsBefore = Object.keys(mem.tables.state.events).length;
    const result = await run(deps, {
      principal: { userId: 'usr_001' },
      name: 'chats.archive',
      input: { conversationId: 'cnv_001', archived: true },
      batch: { storyRefs: new Map(), overviewCalls: 0 },
    });
    if (!result.ok) throw new Error('call failed');
    const signals = result.signals ?? [];
    expect(signals).toHaveLength(1);
    for (const signal of signals) {
      expect(signal.office).toBe(false);
      expect(signal.kinds).toEqual(['chatReads']);
      expect(signal.channel).toBe('person:usr_001');
    }
    expect(Object.keys(mem.tables.state.events)).toHaveLength(eventsBefore);
  });

  it('sends only a person signal when the archive also marks a mention notice read', async () => {
    const office = structuredClone(seed);
    // An unread mention notice of usr_001 for the project chat cnv_001: the archive marks it read (chat design item 20).
    office.notifications.ntf_901 = {
      id: 'ntf_901', userId: 'usr_001', trigger: 'mention', actorId: 'usr_002', targetType: 'chat', targetId: 'cnv_001', messageId: 'msg_001', read: false,
      createdAt: '2026-10-04T08:00:00.000+03:00', dedupeKey: null,
    };
    const mem = memoryData(office);
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(NOW);
    const run = createRunCall({ data: () => mem.data() });
    const result = await run(deps, {
      principal: { userId: 'usr_001' },
      name: 'chats.archive',
      input: { conversationId: 'cnv_001', archived: true },
      batch: { storyRefs: new Map(), overviewCalls: 0 },
    });
    if (!result.ok) throw new Error('call failed');
    expect(mem.tables.state.notifications.ntf_901.read).toBe(true);
    const signals = result.signals ?? [];
    expect(signals).toHaveLength(1);
    expect(signals[0].office).toBe(false);
    expect(signals[0].kinds).toEqual(['chatReads', 'notifications']);
    expect(signals[0].channel).toBe('person:usr_001');
  });
});
