import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { diffState, writeDiff } from '../data/save';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import type { Query } from './ports';
import { createRunCall } from './runCall';
import type { ChangeSignal } from './types';

/**
 * Perf2 SV-7 and DF-2 (owner, 2026-10-21): a direct or group chat tells only its members. The save sends a person signal to each member and
 * no office signal for the chat part, so the other open tabs skip a badge reload for each message. A project chat keeps its office signal.
 * The sample office: cnv_013 is the direct chat of Hala (usr_001) and Faisal (usr_002); cnv_015 is a group of usr_002, usr_001, usr_005, usr_003;
 * cnv_001 is the chat of project prj_001.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
const DIRECT = 'cnv_013';
const DIRECT_MEMBERS = ['usr_001', 'usr_002'];
const SECRET = 'SIGNAL-SECRET-7731';

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function world(setup?: (office: State) => void) {
  const office = structuredClone(seed);
  setup?.(office);
  const mem = memoryData(office);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  const call = (userId: string, name: string, input: Record<string, unknown>) =>
    run(deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
  const mustCall = async (userId: string, name: string, input: Record<string, unknown>) => {
    const result = await call(userId, name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.message}`);
    return result;
  };
  return { mem, deps, call, mustCall, sent: () => deps.signal.sent };
}

const channels = (signals: ChangeSignal[]) => signals.map((signal) => signal.channel).sort();
const persons = (ids: string[]) => ids.map((id) => `person:${id}`).sort();

describe('a direct chat message signals its two members only', () => {
  it('sends person signals to both members and no office signal', async () => {
    const w = world();
    await w.mustCall('usr_002', 'chats.send', { conversationId: DIRECT, body: SECRET });
    expect(channels(w.sent())).toEqual(persons(DIRECT_MEMBERS));
    for (const signal of w.sent()) {
      expect(signal.kinds).toContain('messages');
      expect(signal.people).toEqual([signal.channel.slice('person:'.length)]);
    }
  });

  it('names nothing of the text, the message or the chat', async () => {
    const w = world();
    await w.mustCall('usr_002', 'chats.send', { conversationId: DIRECT, body: SECRET });
    const text = JSON.stringify(w.sent());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(DIRECT);
    expect(text).not.toMatch(/msg_/);
  });

  it('sends the sender the same signal in the answer, so the own pass shows the message at once', async () => {
    const w = world();
    const sent = await w.mustCall('usr_002', 'chats.send', { conversationId: DIRECT, body: 'hello' });
    expect(channels(sent.signals ?? [])).toEqual(['person:usr_002']);
    expect(sent.signals?.[0].kinds).toContain('messages');
    const other = w.sent().find((signal) => signal.channel === 'person:usr_001')!;
    expect(other.id).toBe(sent.signals?.[0].id);
  });

  it('gives a person who is not in the chat no signal at all, for a message, an edit, a reaction and a delete', async () => {
    const w = world();
    const first = await w.mustCall('usr_002', 'chats.send', { conversationId: DIRECT, body: SECRET });
    const id = (first.output as { id?: string; message?: { id: string } }).message?.id ?? (first.output as { id: string }).id;
    await w.mustCall('usr_002', 'chats.editMessage', { id, body: `${SECRET} edited` });
    await w.mustCall('usr_001', 'reactions.toggle', { messageId: id, emoji: '👍' });
    await w.mustCall('usr_002', 'chats.deleteMessage', { id });
    await w.mustCall('usr_002', 'chats.deleteMessage', { id, deleted: false });
    await w.mustCall('usr_001', 'chats.markRead', { conversationId: DIRECT, seen: true });
    expect(w.sent().length).toBeGreaterThan(4);
    for (const signal of w.sent()) expect(DIRECT_MEMBERS.map((m) => `person:${m}`)).toContain(signal.channel);
  });
});

describe('a group message signals its members only', () => {
  const GROUP_MEMBERS = ['usr_001', 'usr_003', 'usr_005'];
  async function group(w: ReturnType<typeof world>) {
    const made = await w.mustCall(ADMIN, 'chats.createGroup', { name: 'Tower team', memberIds: ['usr_003', 'usr_005'] });
    w.sent().length = 0;
    return (made.output as { id: string }).id;
  }

  it('sends one person signal to each member and no office signal', async () => {
    const w = world();
    const id = await group(w);
    await w.mustCall('usr_003', 'chats.send', { conversationId: id, body: SECRET });
    expect(channels(w.sent())).toEqual(persons(GROUP_MEMBERS));
    for (const signal of w.sent()) expect(signal.kinds).toContain('messages');
    expect(JSON.stringify(w.sent())).not.toContain(SECRET);
  });

  it('signals the new group only to its people', async () => {
    const w = world();
    await w.mustCall(ADMIN, 'chats.createGroup', { name: 'Tower team', memberIds: ['usr_003', 'usr_005'] });
    expect(channels(w.sent())).toEqual(persons(GROUP_MEMBERS));
    for (const signal of w.sent()) expect(signal.kinds).toContain('conversations');
  });

  it('signals the person who is taken out and the person who is added, with the people who stay, and nobody else', async () => {
    const w = world();
    const id = await group(w);
    await w.mustCall(ADMIN, 'chats.updateGroup', { conversationId: id, remove: ['usr_003'], add: ['usr_006'] });
    expect(channels(w.sent())).toEqual(persons(['usr_001', 'usr_003', 'usr_005', 'usr_006']));
    for (const signal of w.sent()) expect(signal.kinds).toContain('conversations');
  });

  it('signals a person who leaves, and the people who stay', async () => {
    const w = world();
    const id = await group(w);
    await w.mustCall('usr_005', 'chats.leaveGroup', { conversationId: id });
    expect(channels(w.sent())).toEqual(persons(GROUP_MEMBERS));
  });

  it('signals a rename to the members only', async () => {
    const w = world();
    const id = await group(w);
    await w.mustCall(ADMIN, 'chats.updateGroup', { conversationId: id, name: 'Tower crew' });
    expect(channels(w.sent())).toEqual(persons(GROUP_MEMBERS));
  });
});

describe('a project chat keeps its office signal', () => {
  it('sends the office signal with the actor and the story, as before', async () => {
    const w = world();
    await w.mustCall('usr_002', 'chats.send', { conversationId: 'cnv_001', body: 'project line' });
    const office = w.sent().find((signal) => signal.channel === 'office')!;
    expect(office).toBeDefined();
    expect(office.kinds).toContain('messages');
    expect(office).toMatchObject({ actorId: 'usr_002' });
    expect(office).toHaveProperty('storyId');
  });
});

describe('the statements and the sends of one chat message (perf2 SV-7)', () => {
  /** Runs the save and signal step of one real call on a counting query. Before: the office_meta update, the person_seq upsert and the send. */
  async function counted(setup: (office: State) => void, userId: string, name: string, input: (id: string) => Record<string, unknown>) {
    const w = world(setup);
    const before = structuredClone(w.mem.tables.state);
    const result = await w.mustCall(userId, name, input('cnv_901'));
    const after = w.mem.tables.state;
    const sql: string[] = [];
    const q: Query = async <R,>(text: string, values?: unknown[]) => {
      sql.push(text);
      if (text.includes('update office_meta')) return [{ version: '8', office_seq: '41' }] as R[];
      if (text.includes('insert into person_seq')) return (values![0] as string[]).map((id) => ({ user_id: id, seq: '1' })) as R[];
      return [] as R[];
    };
    const saved = await writeDiff(q, diffState(before, after), { story: { storyId: 'sty_x', actorId: userId } });
    void result;
    // The send is one more statement when the save has signals (signal/realtime.ts).
    return { statements: sql.length + (saved.signals.length > 0 ? 1 : 0), signals: saved.signals, officeMeta: sql.filter((s) => s.includes('update office_meta')).length };
  }
  const group = (office: State) => {
    office.conversations.cnv_901 = {
      id: 'cnv_901', kind: 'group', projectId: null, memberIds: ['usr_002', 'usr_001', 'usr_005', 'usr_003', 'usr_004'], name: 'Tower team', makerId: 'usr_002',
      createdAt: '2026-10-04T10:00:00.000+03:00',
    } as State['conversations'][string];
  };
  const direct = (office: State) => {
    office.conversations.cnv_901 = { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_001', 'usr_002'], createdAt: '2026-10-04T10:00:00.000+03:00' } as State['conversations'][string];
  };

  it('a direct message: no office_meta update, 2 person signals in one send', async () => {
    const r = await counted(direct, 'usr_002', 'chats.send', (id) => ({ conversationId: id, body: 'hi' }));
    expect(r.signals.map((s) => s.channel).sort()).toEqual(['person:usr_001', 'person:usr_002']);
    expect(r.officeMeta).toBe(0);
    // Before (2026-10-21): an office signal and 1 person signal in the send, 7 statements (the office_meta update was one). After: 2 person signals, 6.
    expect(r.statements).toBe(6);
  });

  it('a message in a group of 5: one person_seq upsert and one send for all 5 members', async () => {
    const r = await counted(group, 'usr_002', 'chats.send', (id) => ({ conversationId: id, body: 'hi' }));
    expect(r.signals.map((s) => s.channel).sort()).toEqual(persons(['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005']));
    expect(r.officeMeta).toBe(0);
    expect(r.statements).toBe(6);
  });
});
