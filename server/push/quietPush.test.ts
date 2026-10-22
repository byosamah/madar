import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import type { RunCall } from '../core/runCall';
import { QUIET_SQL, QUIET_LITE, isQuietNow } from '../core/quiet';
import { memoryMailDb } from '../mail/memoryMailDb';
import { fakeDeps } from '../test/fakes/deps';
import { HELD_PEOPLE_SQL, releaseHeld } from './held';
import {
  PUSH_DEVICES_SQL, PUSH_HOLD_LITE, PUSH_HOLD_SQL, PUSH_RELEASE_LITE, PUSH_RELEASE_SQL, PUSH_SENT_LITE, PUSH_SENT_SQL, PUSH_STILL_NEW_SQL, sendChatPush, sendPushNotify,
} from './notify';
import { makeVapidKeys } from './vapid';

/**
 * Quiet hours in the push effects (owner, 2026-10-22, fbk_048). A person in quiet hours gets no push at send time: the devices are marked
 * held, and the row ends as done. The job step held.ts sends ONE fixed push when the quiet hours are over, only if something is unread.
 * These tests run on a real SQLite office. The Postgres texts are checked for their rules here and run in server/it/push.it.test.ts.
 */

const PUSH = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
/** Sunday 2026-10-04. 06:00Z is 09:00 in Riyadh (work), 16:00Z is 19:00 (quiet), and Thursday 2026-10-08 20:00Z is Friday 23:00 (quiet). */
const MORNING = new Date('2026-10-04T06:00:00Z');
const EVENING = new Date('2026-10-04T16:00:00Z');
const STAMP = '2026-10-04T09:00:00.000+03:00';

async function office(at: Date, edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  seed.pushDevices = {
    pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH('aa'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
    pdv_902: { id: 'pdv_902', userId: 'usr_002', endpoint: PUSH('bb'), label: 'Laptop', createdAt: STAMP, lastPushAt: null },
    pdv_903: { id: 'pdv_903', userId: 'usr_003', endpoint: PUSH('cc'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
  };
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const keys = await makeVapidKeys();
  const deps = fakeDeps({ db: lite.db, config: { push: { ...keys, subject: 'mailto:madar@vado.sa' } } });
  deps.clock.set(at);
  const posted: string[] = [];
  deps.pushFetch = (async (input: RequestInfo | URL) => {
    posted.push(String(input));
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  const held = async () => (await lite.db.statement<{ endpoint: string; doc: { heldAt?: string } }>('read', 'select endpoint, doc from push_devices order by endpoint'))
    .map((row) => [row.endpoint.slice(-2), row.doc.heldAt ?? null]);
  return { ...lite, seed, deps, posted, held };
}

const setHours = (userId: string, workHours: object) => (seed: State) => {
  seed.users[userId] = { ...seed.users[userId], preferences: { ...seed.users[userId].preferences, workHours: workHours as never } };
};

describe('isQuietNow on SQLite', () => {
  it('is false in the default work hours, true in the evening and all of Friday, and follows the choice of the person', async () => {
    const { deps } = await office(MORNING, setHours('usr_003', { quiet: false, days: [0], from: '09:00', to: '10:00' }));
    expect(await isQuietNow(deps.db, 'usr_002', MORNING)).toBe(false);
    expect(await isQuietNow(deps.db, 'usr_002', EVENING)).toBe(true);
    expect(await isQuietNow(deps.db, 'usr_002', new Date('2026-10-08T20:00:00Z'))).toBe(true);
    expect(await isQuietNow(deps.db, 'usr_003', EVENING)).toBe(false);
    expect(await isQuietNow(deps.db, 'usr_404', EVENING)).toBe(false);
  });

  it('follows the office default and the lock that the Admin sets', async () => {
    const { deps } = await office(MORNING, (seed) => {
      seed.settings = { ...seed.settings, workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '21:00', lock: { on: true, days: [0, 1, 2, 3, 4], from: '09:00', to: '21:00' } } };
    });
    expect(await isQuietNow(deps.db, 'usr_002', EVENING)).toBe(false);
    expect(await isQuietNow(deps.db, 'usr_002', new Date('2026-10-04T18:30:00Z'))).toBe(true);
  });
});

describe('sendPushNotify in quiet hours', () => {
  it('posts nothing in quiet hours, marks the devices of the person held, and leaves the devices of others alone', async () => {
    const { deps, posted, held } = await office(EVENING);
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(posted).toEqual([]);
    expect(await held()).toEqual([['aa', '2026-10-04T19:00:00.000+03:00'], ['bb', '2026-10-04T19:00:00.000+03:00'], ['cc', null]]);
  });

  it('keeps the first mark when a second push is held', async () => {
    const { deps, held } = await office(EVENING);
    await sendPushNotify({ userId: 'usr_002' }, deps);
    deps.clock.set(new Date('2026-10-04T17:00:00Z'));
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect((await held())[0]).toEqual(['aa', '2026-10-04T19:00:00.000+03:00']);
  });

  it('posts in work hours and marks nothing', async () => {
    const { deps, posted, held } = await office(MORNING);
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(posted.sort()).toEqual([PUSH('aa'), PUSH('bb')]);
    expect((await held()).every(([, mark]) => mark === null)).toBe(true);
  });

  it('posts in the evening to a person who turned quiet hours off', async () => {
    const { deps, posted } = await office(EVENING, setHours('usr_002', { quiet: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' }));
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(posted).toHaveLength(2);
  });

  it('clears the mark of a device that takes a push, so the quiet end sends it nothing more', async () => {
    const { deps, held, db } = await office(MORNING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    expect((await held())[0][1]).toBe(STAMP);
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(await held()).toEqual([['aa', null], ['bb', null], ['cc', null]]);
  });
});

describe('sendChatPush in quiet hours', () => {
  it('holds the devices after the wait when an item is still new, and posts nothing', async () => {
    // A message newer than any read mark: it is still new, so the effect reaches the quiet rule.
    const message = { id: 'msg_9001', conversationId: '' };
    const { deps, posted, held } = await office(EVENING, (seed) => {
      const first = Object.values(seed.messages)[0];
      message.conversationId = first.conversationId;
      seed.messages.msg_9001 = { ...first, id: 'msg_9001', createdAt: '2026-10-04T18:59:00.000+03:00', editedAt: null, mentions: [] };
    });
    await sendChatPush({ userId: 'usr_002', items: [{ chatId: message.conversationId, itemId: message.id }] }, deps);
    expect(posted).toEqual([]);
    expect((await held())[0][1]).toBe('2026-10-04T19:00:00.000+03:00');
  });
});

describe('the SQL of the hold keeps its rules', () => {
  it('marks only a device that holds nothing yet, by person, and clears by person', () => {
    expect(PUSH_HOLD_SQL).toContain("where user_id = $1 and doc->>'heldAt' is null");
    expect(PUSH_HOLD_LITE).toContain("json_extract(doc, '$.heldAt') is null");
    expect(PUSH_RELEASE_SQL).toContain("doc - 'heldAt'");
    expect(PUSH_RELEASE_LITE).toContain('json_remove(doc');
    expect(PUSH_SENT_SQL).toContain("- 'heldAt'");
    expect(PUSH_SENT_LITE).toContain("'$.heldAt'");
  });

  it('touches push_devices only', () => {
    for (const text of [PUSH_HOLD_SQL, PUSH_HOLD_LITE, PUSH_RELEASE_SQL, PUSH_RELEASE_LITE, HELD_PEOPLE_SQL]) expect(text).toMatch(/push_devices/);
    expect(QUIET_SQL).toContain("s.id = 'office'");
    expect(QUIET_LITE).toContain("s.id = 'office'");
  });
});

describe('a push.notify row in quiet hours ends as done, and never as a retry', () => {
  let undo: (() => void)[] = [];
  beforeEach(() => {
    undo = [];
  });
  afterEach(() => {
    while (undo.length > 0) undo.pop()!();
    vi.unstubAllGlobals();
  });

  it('on the fake Postgres: reads the work hours with the devices (one statement), then runs PUSH_HOLD_SQL with the person and the stamp', async () => {
    const seen: { text: string; values: unknown[] }[] = [];
    const mem = memoryMailDb((text, values) => {
      seen.push({ text, values });
      if (text === PUSH_DEVICES_SQL) return [{ endpoint: PUSH('aa'), keys: null, work_hours: null, office: null }];
      if (text === PUSH_HOLD_SQL) return [];
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(EVENING);
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(seen).toEqual([
      { text: PUSH_DEVICES_SQL, values: ['usr_002'] },
      { text: PUSH_HOLD_SQL, values: ['usr_002', '2026-10-04T19:00:00.000+03:00'] },
    ]);
  });

  it('on the fake Postgres: a person who turned quiet hours off gets the push, with no extra statement', async () => {
    const seen: string[] = [];
    const mem = memoryMailDb((text) => {
      seen.push(text);
      if (text === PUSH_DEVICES_SQL) return [{ endpoint: PUSH('aa'), keys: null, work_hours: { quiet: false, days: [0], from: '09:00', to: '10:00' }, office: null }];
      if (text === PUSH_SENT_SQL) return [];
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db, config: { push: { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' } } });
    deps.clock.set(EVENING);
    deps.pushFetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(seen).toEqual([PUSH_DEVICES_SQL, PUSH_SENT_SQL]);
  });

  it('on the fake Postgres: a chat push asks still-new first, then the devices with the work hours, then the hold', async () => {
    const seen: string[] = [];
    const mem = memoryMailDb((text) => {
      seen.push(text);
      if (text === PUSH_STILL_NEW_SQL) return [{ item_id: 'msg_1' }];
      if (text === PUSH_DEVICES_SQL) return [{ endpoint: PUSH('aa'), keys: null, work_hours: { quiet: true, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' }, office: null }];
      if (text === PUSH_HOLD_SQL) return [];
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(EVENING);
    await sendChatPush({ userId: 'usr_002', items: [{ chatId: 'cnv_1', itemId: 'msg_1' }] }, deps);
    expect(seen).toEqual([PUSH_STILL_NEW_SQL, PUSH_DEVICES_SQL, PUSH_HOLD_SQL]);
  });
});

describe('the quiet end: releaseHeld', () => {
  const answers = (unread: { notices?: number; chats?: number } = { notices: 1 }) => {
    const asked: string[] = [];
    const run: RunCall = async (_deps, req) => {
      asked.push(`${req.principal.userId} ${req.name}`);
      if (req.name === 'notifications.list') {
        return { ok: true, output: Array.from({ length: unread.notices ?? 0 }, (_, i) => ({ notification: { id: `ntf_${i}`, read: false }, gone: false })), changed: false };
      }
      if (req.name === 'chats.list') {
        return { ok: true, output: [{ id: 'cnv_1', unread: unread.chats ?? 0, archived: false }], changed: false };
      }
      return { ok: false, error: { code: 'not_found', message: 'No.' } } as never;
    };
    return { run, asked };
  };

  it('sends nothing while the person is still in quiet hours, and keeps the mark', async () => {
    const { deps, posted, held, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    const { run } = answers();
    expect(await releaseHeld(deps, EVENING, { run })).toEqual({ held: 1, pushed: 0, cleared: 0 });
    expect(posted).toEqual([]);
    expect((await held())[0][1]).toBe(STAMP);
  });

  it('sends ONE push to each device when the quiet hours are over and something is unread, then clears the mark', async () => {
    const { deps, posted, held, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    const next = new Date('2026-10-05T06:00:00Z'); // Monday 09:00
    deps.clock.set(next);
    const { run, asked } = answers({ notices: 2 });
    expect(await releaseHeld(deps, next, { run })).toEqual({ held: 1, pushed: 1, cleared: 1 });
    expect(posted.sort()).toEqual([PUSH('aa'), PUSH('bb')]);
    expect((await held()).every(([, mark]) => mark === null)).toBe(true);
    // The unread test reads as the held person only.
    expect(asked.every((line) => line.startsWith('usr_002 '))).toBe(true);
    // A second run finds nothing held.
    expect(await releaseHeld(deps, next, { run })).toEqual({ held: 0, pushed: 0, cleared: 0 });
    expect(posted).toHaveLength(2);
  });

  it('sends the fixed line: the empty push, with no body', async () => {
    const { deps, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    const bodies: unknown[] = [];
    deps.pushFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body);
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const next = new Date('2026-10-05T06:00:00Z');
    await releaseHeld(deps, next, { run: answers().run });
    expect(bodies).toEqual([undefined, undefined]);
  });

  it('counts an unread chat as something unread', async () => {
    const { deps, posted, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_003', STAMP]);
    const next = new Date('2026-10-05T06:00:00Z');
    await releaseHeld(deps, next, { run: answers({ notices: 0, chats: 3 }).run });
    expect(posted).toEqual([PUSH('cc')]);
  });

  it('sends no push when the person read everything at night, and still clears the mark', async () => {
    const { deps, posted, held, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    const next = new Date('2026-10-05T06:00:00Z');
    expect(await releaseHeld(deps, next, { run: answers({ notices: 0, chats: 0 }).run })).toEqual({ held: 1, pushed: 0, cleared: 1 });
    expect(posted).toEqual([]);
    expect((await held()).every(([, mark]) => mark === null)).toBe(true);
  });

  it('does not count a copy for an Admin as something unread', async () => {
    const { deps, posted, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    const run: RunCall = async (_d, req) => (req.name === 'notifications.list'
      ? { ok: true, output: [{ notification: { id: 'ntf_1', read: false, forUserIds: ['usr_003'] }, gone: false }], changed: false }
      : { ok: true, output: [], changed: false }) as never;
    await releaseHeld(deps, new Date('2026-10-05T06:00:00Z'), { run });
    expect(posted).toEqual([]);
  });

  it('keeps the mark of a device when a push service fails, so the next run tries again, and handles the other people', async () => {
    const { deps, posted, held, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_002', STAMP]);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_003', STAMP]);
    deps.pushFetch = (async (input: RequestInfo | URL) => {
      posted.push(String(input));
      return new Response(null, { status: String(input).endsWith('aa') ? 503 : 201 });
    }) as typeof fetch;
    const next = new Date('2026-10-05T06:00:00Z');
    await expect(releaseHeld(deps, next, { run: answers().run })).rejects.toThrow(/did not reach/);
    // The failing device keeps the mark. The device that took the push lost it, and the other person was handled.
    expect(await held()).toEqual([['aa', STAMP], ['bb', null], ['cc', null]]);
  });

  it('sends the fixed line when the unread test cannot run (the wrong answer is a push, never silence)', async () => {
    const { deps, posted, db } = await office(EVENING);
    await db.statement('write', PUSH_HOLD_LITE, ['usr_003', STAMP]);
    const run: RunCall = async () => {
      throw new Error('The database is away.');
    };
    await releaseHeld(deps, new Date('2026-10-05T06:00:00Z'), { run });
    expect(posted).toEqual([PUSH('cc')]);
  });
});
