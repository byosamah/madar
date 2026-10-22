import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedCalls } from '../../src/api/sharedCalls';
import { AFTER_ANSWER_KINDS, EFFECTS_OF, processOutbox, registerEffect, writeOutbox } from '../core/effects';
import { memoryMailDb } from '../mail/memoryMailDb';
import { fakeDeps } from '../test/fakes/deps';
import {
  PUSH_CHAT_EFFECT, PUSH_DEVICES_SQL, PUSH_EFFECT, PUSH_FACTS_SQL, PUSH_GONE_SQL, PUSH_ITEMS_SQL, PUSH_LEVELS_SQL, PUSH_NEW_NOTICES_SQL, PUSH_PEOPLE_SQL, PUSH_SENT_SQL,
  PUSH_STILL_NEW_SQL, pushRows, sendChatPush, sendPushNotify,
} from './notify';
import { PUSH_FREE_CALLS, registerPushEffects } from './register';
import { makeVapidKeys, type VapidConfig } from './vapid';

/**
 * The push producer and the push effect (owner, 2026-10-08). The SQL runs on the local database in server/it/push.it.test.ts;
 * here a small database in memory answers it, and the SQL texts are checked for the rules that the database must keep.
 */

const NOW = new Date('2026-10-08T10:00:00Z');
const FCM = 'https://fcm.googleapis.com/fcm/send/';

/** A database in memory that answers each producer statement by its exact SQL constant, and records the statements. */
function producerDb(answers: Partial<Record<string, unknown[]>>) {
  const statements: string[] = [];
  const q = (async (text: string) => {
    statements.push(text);
    const found = answers[text];
    if (found === undefined) throw new Error(`Unexpected statement: ${text}`);
    return found;
  }) as never;
  return { q, statements };
}

/** The one row of PUSH_FACTS_SQL (SV-9): the items, the people and the stored levels, each as a list. */
const facts = (items: unknown[], people: unknown[] = PEOPLE_ROWS, levels: unknown[] = []) => [{ items, people, levels }];
const person = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'human', active: true, system_role: null, owner_id: null, device: true, ...over });
const PEOPLE_ROWS = [person('usr_001', { system_role: 'admin' }), person('usr_002'), person('usr_003'), person('usr_004')];
const projectMessage = (over: Record<string, unknown> = {}) => ({
  kind: 'message', id: 'msg_010', chat_id: 'cnv_001', chat_kind: 'project', project_id: 'prj_001', member_ids: [], team_ids: ['usr_002', 'usr_003'], task: null, reply_author_id: null,
  doc: { id: 'msg_010', conversationId: 'cnv_001', authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: ['usr_003'], createdAt: '2026-10-19T09:00:00.000+03:00' },
  ...over,
});
const taskComment = (over: Record<string, unknown> = {}) => ({
  kind: 'comment', id: 'cmt_9', chat_id: 'tsk_001', chat_kind: 'task', project_id: 'prj_001', member_ids: null, team_ids: null, reply_author_id: null,
  task: { id: 'tsk_001', projectId: 'prj_001', ownerId: 'usr_003', createdBy: 'usr_001', helperIds: [] },
  doc: { id: 'cmt_9', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Done.' },
  ...over,
});

describe('pushRows: who gets a push after a save', () => {
  it('asks nothing when the save wrote no notice, no message and no comment', async () => {
    const mem = memoryMailDb();
    expect(await pushRows(mem.q, { kinds: new Set(['tasks']), people: new Set(['usr_002']) })).toEqual([]);
    expect(await pushRows(mem.q, { kinds: new Set(['notifications']), people: new Set() })).toEqual([]);
    expect(await pushRows(mem.q, { kinds: new Set(['messages']), people: new Set(), messageIds: [] })).toEqual([]);
    expect(await pushRows(mem.q, { kinds: new Set(['comments']), people: new Set(), commentIds: [] })).toEqual([]);
    expect(mem.statements).toEqual([]);
  });

  it('reads only the new notices for a save with plain notices, and writes push.notify rows', async () => {
    const { q, statements } = producerDb({ [PUSH_NEW_NOTICES_SQL]: [{ user_id: 'usr_003', target_type: 'task', target_id: 'tsk_001', message_id: null }] });
    const rows = await pushRows(q, { kinds: new Set(['notifications']), people: new Set(['usr_003']) });
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: 'usr_003' } }]);
    expect(statements).toEqual([PUSH_NEW_NOTICES_SQL]);
  });

  it('writes one push.notify row for each person that the database names for the new notices, in order', async () => {
    const seen: unknown[][] = [];
    const q = (async (text: string, values: unknown[]) => {
      expect(text).toBe(PUSH_NEW_NOTICES_SQL);
      seen.push(values);
      return [
        { user_id: 'usr_003', target_type: 'task', target_id: 'tsk_001', message_id: null },
        { user_id: 'usr_002', target_type: 'project', target_id: 'prj_001', message_id: null },
        { user_id: 'usr_003', target_type: 'task', target_id: 'tsk_002', message_id: null },
      ];
    }) as never;
    const rows = await pushRows(q, { kinds: new Set(['notifications', 'tasks']), people: new Set(['usr_003', 'usr_002', 'usr_009']) });
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: 'usr_002' } }, { kind: PUSH_EFFECT, payload: { userId: 'usr_003' } }]);
    expect(seen).toEqual([[['usr_002', 'usr_003', 'usr_009']]]);
  });

  it('reads the items, the people and the levels of a new project message in ONE statement, and pushes only the named person after the wait', async () => {
    // The save holds no notice (kinds messages and chatReads), so PUSH_NEW_NOTICES_SQL does not run.
    const { q, statements } = producerDb({ [PUSH_FACTS_SQL]: facts([projectMessage()]) });
    const rows = await pushRows(q, { kinds: new Set(['messages', 'chatReads']), people: new Set(['usr_002']), messageIds: ['msg_010'] });
    expect(rows).toEqual([{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_003', items: [{ chatId: 'cnv_001', itemId: 'msg_010' }] } }]);
    expect(statements).toEqual([PUSH_FACTS_SQL]);
  });

  it('gives a person who picked All messages every project message, and reads the stored levels of the chat', async () => {
    const seen: unknown[][] = [];
    const q = (async (text: string, values: unknown[]) => {
      if (text !== PUSH_FACTS_SQL) throw new Error(`Unexpected statement: ${text}`);
      seen.push(['facts', values]);
      return facts([projectMessage({ doc: { ...projectMessage().doc, mentions: [] } })], PEOPLE_ROWS, [{ conversation_id: 'cnv_001', user_id: 'usr_001', notify: 'all' }]);
    }) as never;
    const rows = await pushRows(q, { kinds: new Set(['messages']), people: new Set(), messageIds: ['msg_010'] });
    expect(rows).toEqual([{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_001', items: [{ chatId: 'cnv_001', itemId: 'msg_010' }] } }]);
    // The ids of the items go in; the chats of the levels come from the items inside the statement.
    expect(seen).toEqual([['facts', [['msg_010'], []]]]);
  });

  it('lets a person of a role with task.officeAll hear a mention in an office comment, and not a person of another role', async () => {
    const roles = { custom: [{ id: 'rol_001', name: 'Office reader', nameAr: 'قارئ', rights: ['task.officeAll'] }] };
    const office = taskComment({
      task: { id: 'tsk_001', projectId: null, ownerId: 'usr_003', createdBy: 'usr_002', helperIds: [] },
      doc: { id: 'cmt_9', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_003', body: '@[Omar](usr_004) @[Ola](usr_005) see' },
    });
    const people = [person('usr_002'), person('usr_003'), person('usr_004', { role_id: 'rol_001', roles }), person('usr_005', { roles })];
    const { q } = producerDb({ [PUSH_FACTS_SQL]: facts([office], people) });
    const rows = await pushRows(q, { kinds: new Set(['comments']), people: new Set(), commentIds: ['cmt_9'] });
    expect(rows.map((row) => (row.payload as { userId: string }).userId)).toEqual(['usr_002', 'usr_004']);
  });

  it('reads the task and the reply author of a new comment and pushes the lead of the task, with no level read', async () => {
    const { q, statements } = producerDb({ [PUSH_FACTS_SQL]: facts([taskComment()]) });
    const rows = await pushRows(q, { kinds: new Set(['comments']), people: new Set(), commentIds: ['cmt_9'] });
    expect(rows).toEqual([{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_003', items: [{ chatId: 'tsk_001', itemId: 'cmt_9' }] } }]);
    expect(statements).toEqual([PUSH_FACTS_SQL]);
  });

  it('writes no row for a quiet line of a task thread', async () => {
    const line = taskComment({ doc: { id: 'cmt_9', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Moved.', dates: { from: { startDate: null, dueDate: '2026-10-20' }, to: { startDate: null, dueDate: '2026-10-25' } } } });
    const { q } = producerDb({ [PUSH_FACTS_SQL]: facts([line]) });
    expect(await pushRows(q, { kinds: new Set(['comments']), people: new Set(), commentIds: ['cmt_9'] })).toEqual([]);
  });

  it('leaves the new comments out of an Undo call', async () => {
    const { q, statements } = producerDb({});
    expect(await pushRows(q, { kinds: new Set(['comments']), people: new Set(), commentIds: ['cmt_9'] }, { undo: true })).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('joins the mention notice of a new message to the push of that message: ONE push.chat row, no push.notify row', async () => {
    const { q, statements } = producerDb({
      [PUSH_NEW_NOTICES_SQL]: [{ user_id: 'usr_003', target_type: 'chat', target_id: 'cnv_001', message_id: 'msg_010' }],
      [PUSH_FACTS_SQL]: facts([projectMessage()]),
    });
    const rows = await pushRows(q, { kinds: new Set(['notifications', 'messages']), people: new Set(['usr_003']), messageIds: ['msg_010'] });
    expect(rows).toEqual([{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_003', items: [{ chatId: 'cnv_001', itemId: 'msg_010' }] } }]);
    expect(statements).toEqual([PUSH_NEW_NOTICES_SQL, PUSH_FACTS_SQL]);
  });

  it('reads an old message for an edit notice: the save names no message, the notice names it, and the person gets the push after the wait', async () => {
    const edited = projectMessage({ doc: { ...projectMessage().doc, mentions: ['usr_004'], editedAt: '2026-10-19T09:05:00.000+03:00' }, team_ids: ['usr_002', 'usr_003', 'usr_004'] });
    const seen: unknown[][] = [];
    const q = (async (text: string, values: unknown[]) => {
      if (text === PUSH_FACTS_SQL) seen.push(values);
      if (text === PUSH_NEW_NOTICES_SQL) return [{ user_id: 'usr_004', target_type: 'chat', target_id: 'cnv_001', message_id: 'msg_010' }];
      if (text === PUSH_FACTS_SQL) return facts([edited]);
      throw new Error(`Unexpected statement: ${text}`);
    }) as never;
    const rows = await pushRows(q, { kinds: new Set(['notifications', 'messages']), people: new Set(['usr_004']) });
    expect(rows).toEqual([{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_004', items: [{ chatId: 'cnv_001', itemId: 'msg_010' }] } }]);
    expect(seen).toEqual([[['msg_010'], []]]);
  });

  it('writes ONE row for a person who has a plain notice and a new message in the same save: the push.notify row wins', async () => {
    const { q } = producerDb({
      [PUSH_NEW_NOTICES_SQL]: [{ user_id: 'usr_003', target_type: 'task', target_id: 'tsk_001', message_id: null }, { user_id: 'usr_002', target_type: 'task', target_id: 'tsk_001', message_id: null }],
      [PUSH_FACTS_SQL]: facts([projectMessage()]),
    });
    const rows = await pushRows(q, { kinds: new Set(['notifications', 'messages']), people: new Set(['usr_002', 'usr_003']), messageIds: ['msg_010'] });
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: 'usr_002' } }, { kind: PUSH_EFFECT, payload: { userId: 'usr_003' } }]);
  });

  it('writes no row for a message that is deleted by now', async () => {
    const gone = projectMessage({ doc: { ...projectMessage().doc, deletedAt: '2026-10-19T09:00:05.000+03:00' } });
    const { q } = producerDb({ [PUSH_FACTS_SQL]: facts([gone]) });
    expect(await pushRows(q, { kinds: new Set(['messages']), people: new Set(), messageIds: ['msg_010'] })).toEqual([]);
  });

  it('writes no row when nobody has a device', async () => {
    const { q } = producerDb({ [PUSH_FACTS_SQL]: facts([projectMessage()], PEOPLE_ROWS.map((p) => ({ ...p, device: false }))) });
    expect(await pushRows(q, { kinds: new Set(['messages']), people: new Set(), messageIds: ['msg_010'] })).toEqual([]);
  });

  it('leaves no row behind when the call rolls back', async () => {
    const mem = memoryMailDb((text) => (text === PUSH_NEW_NOTICES_SQL ? [{ user_id: 'usr_002', target_type: 'task', target_id: 'tsk_001', message_id: null }] : undefined));
    await expect(mem.db.tx('write', async (q) => {
      await writeOutbox(q, await pushRows(q, { kinds: new Set(['notifications']), people: new Set(['usr_002']) }));
      expect(mem.outbox).toHaveLength(1);
      throw new Error('The call failed after the outbox rows.');
    })).rejects.toThrow('The call failed');
    expect(mem.outbox).toEqual([]);
  });
});

describe('the SQL of the producer keeps the rules', () => {
  it('finds a new notice by the id of the open transaction, unread, for the people of the save', () => {
    expect(PUSH_NEW_NOTICES_SQL).toContain('pg_current_xact_id_if_assigned()');
    expect(PUSH_NEW_NOTICES_SQL).toMatch(/not n\.read/);
    expect(PUSH_NEW_NOTICES_SQL).toMatch(/n\.user_id = any\(\$1::text\[\]\)/);
    expect(PUSH_NEW_NOTICES_SQL).toContain("doc->>'messageId'");
  });

  it('keeps only an active human with at least one device in the notices', () => {
    expect(PUSH_NEW_NOTICES_SQL).toMatch(/u\.kind = 'human'/);
    expect(PUSH_NEW_NOTICES_SQL).toMatch(/u\.active/);
    expect(PUSH_NEW_NOTICES_SQL).toMatch(/exists \(select 1 from push_devices/);
  });

  it('reads the new messages and comments by their ids, with the team of a project chat and only the comments of a task', () => {
    expect(PUSH_ITEMS_SQL).toMatch(/m\.id = any\(\$1::text\[\]\)/);
    expect(PUSH_ITEMS_SQL).toMatch(/k\.id = any\(\$2::text\[\]\)/);
    expect(PUSH_ITEMS_SQL).toContain("k.target_type = 'task'");
    expect(PUSH_ITEMS_SQL).toContain('from members mb');
    expect(PUSH_ITEMS_SQL).toContain('leader_id');
    expect(PUSH_ITEMS_SQL).toContain("k.doc->>'replyToId'");
  });

  it('reads every person with the device flag, and the stored levels of the chats', () => {
    expect(PUSH_PEOPLE_SQL).toContain('push_devices');
    expect(PUSH_PEOPLE_SQL).toContain("doc->>'systemRole'");
    expect(PUSH_LEVELS_SQL).toContain("doc ? 'notify'");
    expect(PUSH_LEVELS_SQL).toContain('from items');
  });

  it('joins the items, the people and the levels into ONE statement, with the people in order of id (SV-9)', () => {
    expect(PUSH_FACTS_SQL).toContain(PUSH_ITEMS_SQL);
    expect(PUSH_FACTS_SQL).toContain(PUSH_PEOPLE_SQL);
    expect(PUSH_FACTS_SQL).toContain(PUSH_LEVELS_SQL);
    expect(PUSH_FACTS_SQL).toContain('jsonb_agg(to_jsonb(people) order by people.id)');
    // Two parameters only: the message ids and the comment ids. The chats of the levels come from the items.
    expect(PUSH_FACTS_SQL).not.toMatch(/\$3/);
  });

  it('reads the devices of an active human, and writes only push_devices', () => {
    expect(PUSH_DEVICES_SQL).toMatch(/u\.kind = 'human'/);
    expect(PUSH_DEVICES_SQL).toMatch(/u\.active/);
    expect(PUSH_SENT_SQL).toMatch(/^update push_devices/);
    expect(PUSH_GONE_SQL).toMatch(/^delete from push_devices/);
  });
});

describe('the registration of the push effects', () => {
  const undo: (() => void)[] = [];
  afterEach(() => {
    while (undo.length > 0) undo.pop()!();
  });

  it('adds the producer to every shared write call except the read marks and the push calls, and the effect handler', () => {
    undo.push(registerPushEffects());
    for (const [name, def] of Object.entries(sharedCalls)) {
      const has = (EFFECTS_OF[name as keyof typeof EFFECTS_OF] ?? []).length > 0;
      expect({ name, has }).toEqual({ name, has: !def.readOnly && !PUSH_FREE_CALLS.has(name) });
    }
    for (const name of ['notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread', 'push.register', 'push.remove']) expect(PUSH_FREE_CALLS.has(name)).toBe(true);
    expect(() => registerEffect(PUSH_EFFECT, async () => undefined)).toThrow(/already registered/);
  });

  it('registers once, and the undo removes everything', () => {
    const remove = registerPushEffects();
    expect(() => registerPushEffects()).toThrow(/already registered/);
    remove();
    expect(EFFECTS_OF['chats.send'] ?? []).toEqual([]);
    registerEffect(PUSH_EFFECT, async () => undefined)();
  });

  it('runs after the answer on the hosted functions, like the notice mail', () => {
    expect(AFTER_ANSWER_KINDS.has(PUSH_EFFECT)).toBe(true);
  });
});

describe('sendPushNotify: the push of one person', () => {
  let vapid: VapidConfig;
  beforeEach(async () => {
    vapid = { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const device = (n: number) => `${FCM}secret-token-${n}`;

  function setup(o: { devices?: string[]; answers?: Record<string, number>; config?: VapidConfig | undefined; noConfig?: boolean } = {}) {
    const devices = o.devices ?? [device(1)];
    const writes: { text: string; values: unknown[] }[] = [];
    const mem = memoryMailDb((text, values) => {
      if (text === PUSH_DEVICES_SQL) return values[0] === 'usr_002' ? devices.map((endpoint) => ({ endpoint })) : [];
      if (text === PUSH_SENT_SQL || text === PUSH_GONE_SQL) {
        writes.push({ text, values });
        return [];
      }
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db, config: o.noConfig ? {} : { push: o.config ?? vapid } });
    deps.clock.set(NOW);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(null, { status: o.answers?.[url] ?? 201 });
    }));
    return { mem, deps, writes, calls };
  }

  it('posts to each device of the person and records the time of the push', async () => {
    const { deps, writes, calls } = setup({ devices: [device(1), device(2)] });
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(calls.sort()).toEqual([device(1), device(2)]);
    expect(writes).toEqual([{ text: PUSH_SENT_SQL, values: [[device(1), device(2)], '2026-10-08T13:00:00.000+03:00'] }]);
  });

  it('sends nothing for a person with no device, an agent or a person who left (the database returns no device)', async () => {
    const { deps, writes, calls } = setup({ devices: [] });
    await sendPushNotify({ userId: 'usr_002' }, deps);
    await sendPushNotify({ userId: 'usr_009' }, deps);
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('removes a device whose push service says it is gone (404 or 410) and keeps the others', async () => {
    const { deps, writes } = setup({ devices: [device(1), device(2), device(3)], answers: { [device(1)]: 410, [device(2)]: 404 } });
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(writes).toContainEqual({ text: PUSH_GONE_SQL, values: [[device(1), device(2)]] });
    expect(writes).toContainEqual({ text: PUSH_SENT_SQL, values: [[device(3)], '2026-10-08T13:00:00.000+03:00'] });
  });

  it('throws after it handled the others when a device answers 429 or 500, so the outbox tries again', async () => {
    for (const status of [429, 500]) {
      const { deps, writes } = setup({ devices: [device(1), device(2)], answers: { [device(1)]: status } });
      await expect(sendPushNotify({ userId: 'usr_002' }, deps)).rejects.toMatchObject({ name: 'PushSendError', status, retryable: true });
      // The good device still got its push and its time.
      expect(writes).toEqual([{ text: PUSH_SENT_SQL, values: [[device(2)], '2026-10-08T13:00:00.000+03:00'] }]);
    }
  });

  it('keeps a refused device, writes nothing for it, does not retry, and logs a warning without the address', async () => {
    const { deps, writes } = setup({ devices: [device(1)], answers: { [device(1)]: 403 } });
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(writes).toEqual([]);
    expect(deps.logs).toEqual([expect.objectContaining({ level: 'warn' })]);
    expect(JSON.stringify(deps.logs)).not.toContain('secret-token');
  });

  it('skips with a warning that names the variables when push is not set up, and never calls a push service', async () => {
    const { deps, calls } = setup({ noConfig: true });
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(calls).toEqual([]);
    expect(deps.logs).toHaveLength(1);
    expect(deps.logs[0].level).toBe('warn');
    expect(deps.logs[0].message).toMatch(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT/);
  });

  it('works through processOutbox: a retryable failure leaves the row for the job, with an error text that has no address', async () => {
    const { mem, deps } = setup({ devices: [device(1)], answers: { [device(1)]: 503 } });
    const undo = registerEffect(PUSH_EFFECT, sendPushNotify);
    try {
      const [id] = await writeOutbox(mem.q, [{ kind: PUSH_EFFECT, payload: { userId: 'usr_002' } }]);
      const result = await processOutbox(deps, [id]);
      expect(result).toEqual({ done: [], failed: [id] });
      expect(mem.outbox[0].error).toMatch(/fcm\.googleapis\.com answered 503/);
      expect(mem.outbox[0].error).not.toContain('secret-token');
    } finally {
      undo();
    }
  });
});

describe('sendChatPush: the push after the wait (item 20)', () => {
  let vapid: VapidConfig;
  beforeEach(async () => {
    vapid = { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const device = (n: number) => `${FCM}secret-token-${n}`;
  const items = [{ chatId: 'cnv_013', itemId: 'msg_901' }];

  function setup(o: { devices?: string[]; stillNew?: string[] } = {}) {
    const asked: { text: string; values: unknown[] }[] = [];
    const mem = memoryMailDb((text, values) => {
      asked.push({ text, values });
      if (text === PUSH_STILL_NEW_SQL) return (o.stillNew ?? []).map((item_id) => ({ item_id }));
      if (text === PUSH_DEVICES_SQL) return (o.devices ?? [device(1)]).map((endpoint) => ({ endpoint }));
      if (text === PUSH_SENT_SQL || text === PUSH_GONE_SQL) return [];
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db, config: { push: vapid } });
    deps.clock.set(NOW);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 201 });
    }));
    return { mem, deps, calls, seen: (text: string) => asked.filter((a) => a.text === text).map((a) => a.values) };
  }

  it('posts to each device of the person when an item is still new', async () => {
    const { deps, calls, seen } = setup({ devices: [device(1)], stillNew: ['msg_901'] });
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(calls).toEqual([device(1)]);
    expect(seen(PUSH_STILL_NEW_SQL)).toEqual([['usr_002', JSON.stringify(items)]]);
  });

  it('sends nothing and reads no device when no item is still new', async () => {
    const { deps, calls, seen } = setup({ devices: [device(1)], stillNew: [] });
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(calls).toEqual([]);
    expect(seen(PUSH_DEVICES_SQL)).toEqual([]);
  });

  it('sends nothing for a row with no items', async () => {
    const { deps, calls, seen } = setup({ stillNew: ['msg_901'] });
    await sendChatPush({ userId: 'usr_002', items: [] }, deps);
    expect(calls).toEqual([]);
    expect(seen(PUSH_STILL_NEW_SQL)).toEqual([]);
  });

  it('keeps the rules in its SQL: the read mark of the person, deletedAt, and the stamps as text', () => {
    for (const part of ['chat_reads', "doc->>'deletedAt' is null", 'collate "C"', "doc->>'lastReadAt'"]) expect(PUSH_STILL_NEW_SQL).toContain(part);
  });

  it('is the handler of push.chat after registerPushEffects: processOutbox runs a push.chat row through sendChatPush', async () => {
    const { mem, deps, calls } = setup({ devices: [device(1)], stillNew: ['msg_901'] });
    const undo = registerPushEffects();
    try {
      const [id] = await writeOutbox(mem.q, [{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_002', items } }]);
      expect(await processOutbox(deps, [id])).toEqual({ done: [id], failed: [] });
      expect(calls).toEqual([device(1)]);
    } finally {
      undo();
    }
  });

  it('runs after the answer and waits, like the other chat kind', () => {
    expect(AFTER_ANSWER_KINDS.has(PUSH_CHAT_EFFECT)).toBe(true);
  });
});

describe('the 15-minute job path', () => {
  it('writes the push rows next to the notice mail rows, in the same transaction as the save', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../jobs/steps/triggers.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { pushRows } from '../../push/notify';");
    expect(source).toMatch(/writeOutbox\(q, \[\.\.\.\(await noticeRows\(q, saved\)\), \.\.\.\(await pushRows\(q, saved\)\)\]\)/);
  });
});
