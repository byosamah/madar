import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { chatReadKey } from '../../src/api/store';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * The signal of a look (chat presence design C4, base B3). A look that moves the seen time signals the reader and the people whose
 * message became seen by it, and nobody else. It is a personal change: kind chatReads, no office signal. The sample office:
 * cnv_013 is the direct chat of Hala (usr_001) and Faisal (usr_002); Faisal wrote msg_014 and msg_016, Hala wrote msg_015.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const DIRECT = 'cnv_013';

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

async function look(input: Record<string, unknown>, o: { userId?: string; setup?: (office: State) => void } = {}) {
  const office = structuredClone(seed);
  o.setup?.(office);
  const mem = memoryData(office);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  const result = await run(deps, {
    principal: { userId: o.userId ?? 'usr_001' },
    name: 'chats.markRead',
    input,
    batch: { storyRefs: new Map(), overviewCalls: 0 },
  });
  if (!result.ok) throw new Error('call failed');
  const signals = deps.signal.sent;
  return { signals, channels: signals.map((signal) => signal.channel).sort(), mem };
}

describe('chats.markRead with seen: true, the signals', () => {
  it("a look that makes Faisal's message seen signals person:usr_002 and the reader", async () => {
    const { channels, mem } = await look({ conversationId: DIRECT, seen: true });
    expect(channels).toEqual(['person:usr_001', 'person:usr_002']);
    expect(mem.tables.state.chatReads[chatReadKey(DIRECT, 'usr_001')]?.seenAt).toBeDefined();
  });

  it('a look with no new message of another person signals only the reader', async () => {
    const { channels } = await look({ conversationId: DIRECT, seen: true }, {
      setup: (office) => {
        // The reader already saw everything until 08:00: Faisal's newest message is from 07:40.
        office.chatReads[chatReadKey(DIRECT, 'usr_001')] = { conversationId: DIRECT, userId: 'usr_001', lastReadAt: '2026-10-04T08:00:00.000+03:00', seenAt: '2026-10-04T08:00:00.000+03:00' };
      },
    });
    expect(channels).toEqual(['person:usr_001']);
  });

  it('a look that only makes the own messages seen signals only the reader', async () => {
    // Faisal looks: Hala wrote msg_015 only after his own old seen time.
    const { channels } = await look({ conversationId: DIRECT, seen: true }, {
      userId: 'usr_002',
      setup: (office) => {
        office.chatReads[chatReadKey(DIRECT, 'usr_002')] = { conversationId: DIRECT, userId: 'usr_002', lastReadAt: '2026-10-03T17:12:00.000+03:00', seenAt: '2026-10-03T17:12:00.000+03:00' };
        delete office.messages.msg_015;
        // Only Faisal's own msg_016 is newer than his seen time.
      },
    });
    expect(channels).toEqual(['person:usr_002']);
  });

  it('a read without the flag signals only the reader', async () => {
    const { channels, mem } = await look({ conversationId: DIRECT });
    expect(channels).toEqual(['person:usr_001']);
    expect(mem.tables.state.chatReads[chatReadKey(DIRECT, 'usr_001')]?.seenAt).toBeUndefined();
  });

  it('sends no office signal', async () => {
    const { signals } = await look({ conversationId: DIRECT, seen: true });
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.office).toBe(false);
      expect(signal.kinds).toEqual(['chatReads']);
      expect(signal.channel.startsWith('person:')).toBe(true);
    }
  });

  it('names no author of another chat', async () => {
    // The project chat cnv_001 has messages of usr_005 and usr_006. A look at the direct chat never names them.
    const { channels } = await look({ conversationId: DIRECT, seen: true });
    expect(channels).not.toContain('person:usr_005');
    expect(channels).not.toContain('person:usr_006');
    const room = await look({ conversationId: 'cnv_001', seen: true }, { userId: 'usr_002' });
    expect(room.channels).not.toContain('person:usr_001');
    expect(room.channels).toEqual(expect.arrayContaining(['person:usr_002']));
  });

  it('signals the person behind an agent that wrote the message', async () => {
    // cnv_015 is a group of usr_002, usr_001, usr_005 and usr_003. An agent of usr_003 writes in it; Hala looks.
    const { channels } = await look({ conversationId: 'cnv_015', seen: true }, {
      setup: (office) => {
        office.users.usr_009.ownerId = 'usr_003';
        office.messages.msg_090 = { id: 'msg_090', conversationId: 'cnv_015', authorId: 'usr_009', actingForId: 'usr_003', body: 'From the agent', mentions: [], createdAt: '2026-10-04T08:00:00.000+03:00', editedAt: null };
      },
    });
    expect(channels).toContain('person:usr_003');
    expect(channels).not.toContain('person:usr_009');
  });
});
