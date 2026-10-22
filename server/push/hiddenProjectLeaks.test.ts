import { describe, expect, it } from 'vitest';
// The mail and push producers and effects that the entries register through server/core/deps.ts.
import '../mail/effects';
import './effects';
import { mentionMarkup } from '../../src/lib/text';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { createRunCall } from '../core/runCall';
import type { BatchScope } from '../core/types';
import { liteData } from '../data/lite/callData';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';

/**
 * The leak probes of the push of a hidden project (hidden projects, owner 2026-10-22, wave D3; the rule of 2026-10-06). The calls run on a
 * real SQLite office through runCall, with the push producers registered, so the probes read the real outbox. prj_001 is hidden: leader
 * usr_002, team usr_002, usr_005, usr_006, usr_008, chosen person usr_007, Admin usr_001. usr_003, usr_004, usr_010 and usr_011 are outsiders.
 */

const TODAY = '2026-10-04';
const STAMP = '2026-10-04T09:00:00.000+03:00';
const NOW = new Date('2026-10-04T06:00:00Z');
const SECRET = 'SECRET-EVERYONE-TEXT-4417';
const batchOf = (): BatchScope => ({ storyRefs: new Map(), overviewCalls: 0 });
const PUSH = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

async function office(edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  // Everyone has one push device and the default switches, so any leak would show as an outbox row.
  seed.pushDevices = Object.fromEntries(Object.keys(seed.users).map((id) => [`pdv_${id}`, {
    id: `pdv_${id}`, userId: id, endpoint: PUSH(id), label: 'Phone', createdAt: STAMP, lastPushAt: null,
  }]));
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: liteData });
  const call = async <T = unknown>(name: string, input: unknown, userId: string): Promise<{ ok: true; output: T } | { ok: false; error: { code: string; message: string; details?: unknown } }> =>
    (await run(deps, { principal: { userId }, name, input, batch: batchOf() })) as never;
  const must = async <T>(name: string, input: unknown, userId: string): Promise<T> => {
    const result = await call<T>(name, input, userId);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
    return result.output;
  };
  const outbox = async () => (await lite.db.statement<{ kind: string; payload: string | object }>('read', 'select kind, payload from outbox order by id'))
    .map((row) => ({ kind: row.kind, ...((typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { userId?: string; notificationId?: string }) }));
  const noticesTo = async (messageId: string) => (await lite.db.statement<{ user_id: string; doc: { everyone?: true; messageId?: string } }>('read', 'select user_id, doc from notifications'))
    .filter((row) => row.doc.messageId === messageId).map((row) => row.user_id).sort();
  return { ...lite, seed, deps, call, must, outbox, noticesTo };
}

type Office = Awaited<ReturnType<typeof office>>;

const HIDDEN = 'prj_001';
const OUTSIDERS = ['usr_003', 'usr_004', 'usr_010', 'usr_011'];
const hide = (seed: State) => {
  seed.projects[HIDDEN] = { ...seed.projects[HIDDEN], access: { hidden: true, viewerIds: ['usr_007'] } };
};
/** The people who got a push row after the outbox had `since` rows. */
async function pushed(o: Office, since: number): Promise<string[]> {
  return [...new Set((await o.outbox()).slice(since).filter((row) => row.kind.startsWith('push.')).map((row) => row.userId!))].sort();
}
const mention = (name: string, id: string) => mentionMarkup(name, id);

describe('a comment on a to-do of a hidden project', () => {
  it('pushes the people who view the project that it names, and never an outsider', async () => {
    const o = await office(hide);
    const task = Object.values(o.seed.tasks).find((t) => t.projectId === HIDDEN && t.ownerId !== null)!;
    const before = (await o.outbox()).length;
    const body = `${SECRET} ${mention('Four', 'usr_004')} ${mention('Seven', 'usr_007')} ${mention('Five', 'usr_005')} ${mention('Three', 'usr_003')}`;
    await o.must('comments.create', { targetType: 'task', targetId: task.id, body }, 'usr_002');
    const got = await pushed(o, before);
    for (const outsider of OUTSIDERS) expect(got, outsider).not.toContain(outsider);
    expect(got).toEqual(expect.arrayContaining(['usr_005', 'usr_007']));
  });
});

describe('a message in the chat of a hidden project', () => {
  it('pushes the team that it names, and never an outsider that it names', async () => {
    const o = await office(hide);
    const chat = Object.values(o.seed.conversations).find((c) => c.projectId === HIDDEN)!;
    const before = (await o.outbox()).length;
    await o.must('chats.send', { conversationId: chat.id, body: `${SECRET} ${mention('Four', 'usr_004')} ${mention('Five', 'usr_005')} ${mention('Seven', 'usr_007')}` }, 'usr_002');
    const got = await pushed(o, before);
    for (const outsider of OUTSIDERS) expect(got, outsider).not.toContain(outsider);
    expect(got).toContain('usr_005');
  });
});

describe('with the default settings', () => {
  it('pushes an outsider of an open project that a comment names, as before', async () => {
    const o = await office();
    const task = Object.values(o.seed.tasks).find((t) => t.projectId === HIDDEN && t.ownerId !== null)!;
    const before = (await o.outbox()).length;
    await o.must('comments.create', { targetType: 'task', targetId: task.id, body: `${mention('Four', 'usr_004')} please look` }, 'usr_002');
    expect(await pushed(o, before)).toContain('usr_004');
  });
});
