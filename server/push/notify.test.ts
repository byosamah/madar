import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedCalls } from '../../src/api/sharedCalls';
import { AFTER_ANSWER_KINDS, EFFECTS_OF, processOutbox, registerEffect, writeOutbox } from '../core/effects';
import { memoryMailDb } from '../mail/memoryMailDb';
import { fakeDeps } from '../test/fakes/deps';
import {
  PUSH_DEVICES_SQL, PUSH_EFFECT, PUSH_GONE_SQL, PUSH_MESSAGE_PEOPLE_SQL, PUSH_NOTICE_PEOPLE_SQL, PUSH_SENT_SQL, pushRows, sendPushNotify,
} from './notify';
import { PUSH_FREE_CALLS, registerPushEffects } from './register';
import { makeVapidKeys, type VapidConfig } from './vapid';

/**
 * The push producer and the push effect (owner, 2026-10-08). The SQL runs on the local database in server/it/push.it.test.ts;
 * here a small database in memory answers it, and the SQL texts are checked for the rules that the database must keep.
 */

const NOW = new Date('2026-10-08T10:00:00Z');
const FCM = 'https://fcm.googleapis.com/fcm/send/';

describe('pushRows: who gets a push after a save', () => {
  it('asks nothing when the save wrote no notice and no message', async () => {
    const mem = memoryMailDb();
    expect(await pushRows(mem.q, { kinds: new Set(['tasks']), people: new Set(['usr_002']) })).toEqual([]);
    expect(await pushRows(mem.q, { kinds: new Set(['notifications']), people: new Set() })).toEqual([]);
    expect(await pushRows(mem.q, { kinds: new Set(['messages']), people: new Set(), messageIds: [] })).toEqual([]);
    expect(mem.statements).toEqual([]);
  });

  it('writes one row for each person that the database names for the new notices, in order', async () => {
    const seen: unknown[][] = [];
    const q = (async (text: string, values: unknown[]) => {
      expect(text).toBe(PUSH_NOTICE_PEOPLE_SQL);
      seen.push(values);
      return [{ user_id: 'usr_002' }, { user_id: 'usr_003' }];
    }) as never;
    const rows = await pushRows(q, { kinds: new Set(['notifications', 'tasks']), people: new Set(['usr_003', 'usr_002', 'usr_009']) });
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: 'usr_002' } }, { kind: PUSH_EFFECT, payload: { userId: 'usr_003' } }]);
    expect(seen).toEqual([[['usr_002', 'usr_003', 'usr_009']]]);
  });

  it('writes the rows of the new messages for the people that the database names', async () => {
    const seen: unknown[][] = [];
    const q = (async (text: string, values: unknown[]) => {
      expect(text).toBe(PUSH_MESSAGE_PEOPLE_SQL);
      seen.push(values);
      return [{ user_id: 'usr_004' }];
    }) as never;
    const rows = await pushRows(q, { kinds: new Set(['messages', 'chatReads']), people: new Set(['usr_002']), messageIds: ['msg_010', 'msg_011'] });
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: 'usr_004' } }]);
    expect(seen).toEqual([[['msg_010', 'msg_011']]]);
  });

  it('writes ONE row for a person who has a new notice and a new message in the same save', async () => {
    const q = (async (text: string) => {
      if (text === PUSH_NOTICE_PEOPLE_SQL) return [{ user_id: 'usr_003' }, { user_id: 'usr_002' }];
      if (text === PUSH_MESSAGE_PEOPLE_SQL) return [{ user_id: 'usr_003' }, { user_id: 'usr_005' }];
      throw new Error(`Unexpected statement: ${text}`);
    }) as never;
    const rows = await pushRows(q, { kinds: new Set(['notifications', 'messages']), people: new Set(['usr_002', 'usr_003']), messageIds: ['msg_001'] });
    expect(rows.map((row) => row.payload.userId)).toEqual(['usr_002', 'usr_003', 'usr_005']);
  });

  it('writes no row when nobody has a device', async () => {
    const q = (async () => []) as never;
    expect(await pushRows(q, { kinds: new Set(['notifications', 'messages']), people: new Set(['usr_002']), messageIds: ['msg_001'] })).toEqual([]);
  });

  it('leaves no row behind when the call rolls back', async () => {
    const mem = memoryMailDb((text) => (text === PUSH_NOTICE_PEOPLE_SQL ? [{ user_id: 'usr_002' }] : undefined));
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
    expect(PUSH_NOTICE_PEOPLE_SQL).toContain('pg_current_xact_id_if_assigned()');
    expect(PUSH_NOTICE_PEOPLE_SQL).toMatch(/not n\.read/);
    expect(PUSH_NOTICE_PEOPLE_SQL).toMatch(/n\.user_id = any\(\$1::text\[\]\)/);
  });

  it('keeps only an active human with at least one device (notices and messages)', () => {
    for (const sql of [PUSH_NOTICE_PEOPLE_SQL, PUSH_MESSAGE_PEOPLE_SQL]) {
      expect(sql).toMatch(/u\.kind = 'human'/);
      expect(sql).toMatch(/u\.active/);
      expect(sql).toMatch(/exists \(select 1 from push_devices/);
    }
  });

  it('never sends a message to its sender: the author and the person the author acts for', () => {
    expect(PUSH_MESSAGE_PEOPLE_SQL).toMatch(/is distinct from a\.author_id/);
    expect(PUSH_MESSAGE_PEOPLE_SQL).toMatch(/is distinct from a\.acting_for_id/);
  });

  it('reads the new messages by their ids, with a direct chat or a group to its members and a project chat to its leader, team and Admins', () => {
    expect(PUSH_MESSAGE_PEOPLE_SQL).toMatch(/m\.id = any\(\$1::text\[\]\)/);
    expect(PUSH_MESSAGE_PEOPLE_SQL).toContain("s.kind in ('direct', 'group')");
    expect(PUSH_MESSAGE_PEOPLE_SQL).toContain('p.leader_id');
    expect(PUSH_MESSAGE_PEOPLE_SQL).toContain('from sent s join members mb');
    expect(PUSH_MESSAGE_PEOPLE_SQL).toContain("adm.doc->>'systemRole' = 'admin'");
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

describe('the 15-minute job path', () => {
  it('writes the push rows next to the notice mail rows, in the same transaction as the save', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../jobs/steps/triggers.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { pushRows } from '../../push/notify';");
    expect(source).toMatch(/writeOutbox\(q, \[\.\.\.\(await noticeRows\(q, saved\)\), \.\.\.\(await pushRows\(q, saved\)\)\]\)/);
  });
});
