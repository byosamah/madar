import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * Leak tests of perf2 SV-7 and DF-2 (owner, 2026-10-21; the builder writes them, no separate leak review). A person outside a direct chat or a
 * group gets no signal and no change for its messages: not the count, not the time, not the kinds, on every read path, in every error text
 * and on Realtime. The outsider is the Admin (usr_001) in a direct chat of two Members, and a Member (usr_004) in a group. Positive
 * tests of who does hear are in chatSignalMembers.test.ts.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const AGENT = 'usr_009';

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function world() {
  const mem = memoryData(structuredClone(seed));
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  const call = (userId: string, name: string, input: Record<string, unknown>) =>
    run(deps, {
      principal: userId === AGENT ? { userId, agent: { clientId: 'cli-test' } } : { userId },
      name, input, batch: { storyRefs: new Map(), overviewCalls: 0 },
    });
  const mustCall = async (userId: string, name: string, input: Record<string, unknown>) => {
    const result = await call(userId, name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.message}`);
    return result;
  };
  return { mem, deps, call, mustCall, sent: () => deps.signal.sent };
}
type World = ReturnType<typeof world>;

const READS: [string, Record<string, unknown>][] = [
  ['chats.list', {}],
  ['chats.unreadCount', {}],
  ['notifications.list', {}],
  ['notifications.count', {}],
  ['search.query', { text: 'leakword' }],
  ['events.list', {}],
];

async function readAll(w: World, userId: string) {
  const out: Record<string, unknown> = {};
  for (const [name, input] of READS) out[name] = (await w.mustCall(userId, name, input)).output;
  return out;
}

/** What the outsider's Realtime topic and the office counters hold: the person counter, the office counter and the office version. */
const counters = (w: World, outsider: string) => ({
  person: w.mem.tables.personSeq.get(outsider) ?? 0, officeSeq: w.mem.tables.officeSeq, version: w.mem.tables.version,
});

async function direct(w: World): Promise<string> {
  const made = await w.mustCall('usr_002', 'chats.openDirect', { userId: 'usr_003' });
  return (made.output as { id: string }).id;
}
async function group(w: World): Promise<string> {
  const made = await w.mustCall('usr_002', 'chats.createGroup', { name: 'Leak group', memberIds: ['usr_003', 'usr_005'] });
  return (made.output as { id: string }).id;
}

describe.each([
  ['a direct chat', 'usr_001', direct],
  ['a group', 'usr_004', group],
] as const)('an outsider of %s learns nothing of its messages', (_label, outsider, open) => {
  it('gets no signal and no counter change for a message, an edit, a reaction and a delete', async () => {
    const w = world();
    const id = await open(w);
    w.sent().length = 0;
    const start = counters(w, outsider);
    const first = await w.mustCall('usr_003', 'chats.send', { conversationId: id, body: 'leakword one' });
    const message = (first.output as { message: { id: string } }).message.id;
    await w.mustCall('usr_003', 'chats.editMessage', { id: message, body: 'leakword two' });
    await w.mustCall('usr_002', 'reactions.toggle', { messageId: message, emoji: '👍' });
    await w.mustCall('usr_003', 'chats.deleteMessage', { id: message });
    expect(w.sent().length).toBeGreaterThan(0);
    expect(w.sent().some((signal) => signal.channel === 'office' || signal.channel === `person:${outsider}`)).toBe(false);
    expect(JSON.stringify(w.sent())).not.toContain(outsider);
    expect(counters(w, outsider)).toEqual(start);
  });

  it('gets the same answer on every read path before and after a message', async () => {
    const w = world();
    const id = await open(w);
    const before = await readAll(w, outsider);
    await w.mustCall('usr_003', 'chats.send', { conversationId: id, body: 'leakword three' });
    await w.mustCall('usr_002', 'chats.send', { conversationId: id, body: 'leakword four' });
    expect(await readAll(w, outsider)).toEqual(before);
  });

  it('gets the answer for a chat that never existed, for its messages, marks, send and archive', async () => {
    const w = world();
    const id = await open(w);
    await w.mustCall('usr_003', 'chats.send', { conversationId: id, body: 'leakword five' });
    for (const [name, extra] of [['chats.messages', {}], ['chats.markRead', {}], ['chats.send', { body: 'x' }], ['chats.archive', { archived: true }]] as const) {
      const real = await w.call(outsider, name, { conversationId: id, ...extra });
      const ghost = await w.call(outsider, name, { conversationId: 'cnv_999', ...extra });
      expect(real.ok, name).toBe(false);
      expect(ghost.ok, name).toBe(false);
      if (real.ok || ghost.ok) continue;
      // The same code and the same text, with the id of the chat swapped.
      expect(JSON.stringify(real.error).replaceAll(id, 'X')).toBe(JSON.stringify(ghost.error).replaceAll('cnv_999', 'X'));
    }
  });
});

describe('the Realtime topics of the outsiders', () => {
  it('a group made, renamed, left and changed in its people reaches the members and the people taken out or added, and nobody else', async () => {
    const w = world();
    const id = await group(w);
    const everyone = new Set(Object.values(seed.users).filter((u) => u.kind === 'human').map((u) => `person:${u.id}`));
    const heard = (): Set<string> => new Set(w.sent().map((signal) => signal.channel));
    expect([...heard()].sort()).toEqual(['person:usr_002', 'person:usr_003', 'person:usr_005']);
    await w.mustCall('usr_002', 'chats.updateGroup', { conversationId: id, name: 'Renamed', remove: ['usr_003'], add: ['usr_006'] });
    await w.mustCall('usr_005', 'chats.leaveGroup', { conversationId: id });
    const outsiders = [...everyone].filter((channel) => !['person:usr_002', 'person:usr_003', 'person:usr_005', 'person:usr_006'].includes(channel));
    expect(outsiders.length).toBeGreaterThan(5);
    for (const channel of outsiders) expect(heard().has(channel), channel).toBe(false);
    expect(heard().has('office')).toBe(false);
  });

  it('an agent that sends in a chat for its person signals that person, never the agent topic', async () => {
    const w = world();
    // usr_009 is the agent of the Admin. The Admin and Faisal have the direct chat cnv_013.
    const sent = await w.call(AGENT, 'chats.send', { conversationId: 'cnv_013', body: 'agent line' });
    if (!sent.ok) throw new Error(`send failed: ${sent.error.message}`);
    const channels = w.sent().map((signal) => signal.channel).sort();
    expect(channels).toEqual(['person:usr_001', 'person:usr_002']);
  });
});
