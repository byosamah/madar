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
 * The leak probes of @everyone (owner, 2026-10-22, fbk_041; the rule of 2026-10-06 for a feature that reaches people by a rule). The calls
 * run on a real SQLite office through runCall, with the mail and push producers registered, so the probes read the real outbox, the real
 * notices and the real Realtime signals. Each case says who is in and who is out.
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

/** The ids that an outbox of rows reaches: the push rows (payload.userId) and the mail rows (the person of the notice). */
async function reached(o: Office, since = 0): Promise<{ push: string[]; mail: string[] }> {
  const rows = (await o.outbox()).slice(since);
  const push = rows.filter((row) => row.kind.startsWith('push.')).map((row) => row.userId!).sort();
  const mail = rows.filter((row) => row.kind.startsWith('mail.')).map((row) => row.notificationId ?? row.userId!);
  return { push: [...new Set(push)], mail };
}

describe('@everyone in a group never reaches a person outside the group', () => {
  async function world() {
    const o = await office();
    const group = await o.must<{ id: string }>('chats.createGroup', { name: 'Site visit', memberIds: ['usr_002', 'usr_004'] }, 'usr_003');
    return { o, group: group.id };
  }

  it('reaches the members only: the notice, the push row, the mentions list and the signal', async () => {
    const { o, group } = await world();
    const before = (await o.outbox()).length;
    o.deps.signal.sent.length = 0;
    const sent = await o.must<{ message: { id: string } }>('chats.send', { conversationId: group, body: `${SECRET} @everyone` }, 'usr_003');
    expect(await o.noticesTo(sent.message.id)).toEqual(['usr_002', 'usr_004']);
    expect((await reached(o, before)).push).toEqual(['usr_002', 'usr_004']);
    // The mentions list that the message keeps holds the members, not the outsider.
    const [stored] = await o.db.statement<{ doc: { mentions: string[] } }>('read', 'select doc from messages where id = ?1', [sent.message.id]);
    expect(stored.doc.mentions).toEqual(['usr_002', 'usr_004']);
    // The signals name the project and the kinds of the change, never the outsider and never the words.
    const signals = JSON.stringify(o.deps.signal.sent);
    for (const outsider of ['usr_005', 'usr_001', 'usr_006']) expect(signals, outsider).not.toContain(outsider);
    expect(signals).not.toContain(SECRET);
  });

  it('sends no mail for the notices of @everyone', async () => {
    const { o, group } = await world();
    const before = (await o.outbox()).length;
    await o.must('chats.send', { conversationId: group, body: '@all please read' }, 'usr_003');
    expect((await reached(o, before)).mail).toEqual([]);
    expect(o.deps.mail.sent).toEqual([]);
  });

  it('shows the outsider nothing: no notice, no row, no count, and the same error as for a chat that does not exist', async () => {
    const { o, group } = await world();
    await o.must('chats.send', { conversationId: group, body: `${SECRET} @everyone` }, 'usr_003');
    const list = await o.must<unknown[]>('notifications.list', {}, 'usr_005');
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(JSON.stringify(list)).not.toContain(group);
    expect((await o.must<{ unread: number }>('chats.unreadCount', {}, 'usr_005')).unread).toBe(0);
    expect(JSON.stringify(await o.must('chats.list', {}, 'usr_005'))).not.toContain(group);
    const hidden = await o.call('chats.messages', { conversationId: group }, 'usr_005');
    const missing = await o.call('chats.messages', { conversationId: 'cnv_999' }, 'usr_005');
    expect(hidden).toMatchObject({ ok: false, error: { code: 'not_found', message: `Conversation ${group} does not exist.` } });
    expect(missing).toMatchObject({ ok: false, error: { code: 'not_found', message: 'Conversation cnv_999 does not exist.' } });
    expect(JSON.stringify(await o.must('search.query', { text: SECRET }, 'usr_005'))).not.toContain(SECRET);
  });

  it('never names the sender, and never a member who is turned off', async () => {
    const o = await office();
    const group = await o.must<{ id: string }>('chats.createGroup', { name: 'Site visit', memberIds: ['usr_002', 'usr_004'] }, 'usr_003');
    await o.must('users.deactivate', { id: 'usr_004' }, 'usr_001');
    const sent = await o.must<{ message: { id: string } }>('chats.send', { conversationId: group.id, body: '@everyone' }, 'usr_003');
    expect(await o.noticesTo(sent.message.id)).toEqual(['usr_002']);
  });

  it('names nobody in a direct chat', async () => {
    const o = await office();
    const direct = await o.must<{ id: string }>('chats.openDirect', { userId: 'usr_002' }, 'usr_003');
    const sent = await o.must<{ message: { id: string } }>('chats.send', { conversationId: direct.id, body: '@everyone' }, 'usr_003');
    expect(await o.noticesTo(sent.message.id)).toEqual([]);
  });
});

describe('@everyone in an office to-do thread never reaches a person outside its people', () => {
  it('reaches the maker, the lead and the helpers, and not the leader of another project nor the Admin', async () => {
    const o = await office();
    const made = await o.must<{ task: { id: string } }>('tasks.create', { title: 'Renew the licence', ownerId: 'usr_004', helperIds: ['usr_008'] }, 'usr_003');
    const before = (await o.outbox()).length;
    o.deps.signal.sent.length = 0;
    const comment = await o.must<{ comment: { id: string } }>('comments.create', { targetType: 'task', targetId: made.task.id, body: `${SECRET} @everyone` }, 'usr_004');
    // Omar (lead) writes, so the maker Sara and the helper Khalid are named. Faisal leads prj_001 and Hala is the Admin: both stay out.
    expect(await o.noticesTo(comment.comment.id)).toEqual(['usr_003', 'usr_008']);
    expect((await reached(o, before)).push).toEqual(['usr_003', 'usr_008']);
    const signals = JSON.stringify(o.deps.signal.sent);
    // The Admin reads every office to-do (task.officeAll), so the signal of the save reaches the Admin; the leader of another project gets none.
    expect(signals).not.toContain('usr_002');
    expect(signals).not.toContain(SECRET);
    // The leader of another project reads nothing of it, and the error is the one of a task that does not exist.
    const hidden = await o.call('comments.list', { targetType: 'task', targetId: made.task.id }, 'usr_002');
    const missing = await o.call('comments.list', { targetType: 'task', targetId: 'tsk_999' }, 'usr_002');
    expect(hidden).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(missing).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(JSON.stringify(await o.must('notifications.list', {}, 'usr_002'))).not.toContain(made.task.id);
  });
});

describe('@everyone in a project chat', () => {
  it('reaches the team and the leader only: an Admin who is not on the team gets nothing', async () => {
    const o = await office();
    const room = Object.values(o.seed.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const before = (await o.outbox()).length;
    // Faisal (usr_002) leads prj_001. The team of the sample office is usr_005, usr_006 and usr_008.
    const sent = await o.must<{ message: { id: string } }>('chats.send', { conversationId: room.id, body: '@everyone design review' }, 'usr_002');
    const team = ['usr_005', 'usr_006', 'usr_008'];
    expect(await o.noticesTo(sent.message.id)).toEqual(team);
    expect((await reached(o, before)).push).toEqual(team);
    expect(await o.noticesTo(sent.message.id)).not.toContain('usr_001');
  });

  it('reaches the team only when a holder of chat.project.all who is not on the team writes', async () => {
    const o = await office();
    const room = Object.values(o.seed.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const sent = await o.must<{ message: { id: string } }>('chats.send', { conversationId: room.id, body: '@all hello team' }, 'usr_001');
    expect(await o.noticesTo(sent.message.id)).toEqual(['usr_002', 'usr_005', 'usr_006', 'usr_008']);
  });
});

describe('a person without "Mention everyone"', () => {
  it('names nobody, and the answer holds no list of who would have been named', async () => {
    const o = await office((seed) => {
      seed.settings.roles = { off: { member: ['chat.mentionEveryone'] } };
    });
    const group = await o.must<{ id: string }>('chats.createGroup', { name: 'Site visit', memberIds: ['usr_002', 'usr_004'] }, 'usr_003');
    const before = (await o.outbox()).length;
    const body = `${SECRET} @everyone ${mentionMarkup('Omar Haddad', 'usr_004')}`;
    const sent = await o.must<{ message: { id: string; body: string; mentions?: unknown } }>('chats.send', { conversationId: group.id, body }, 'usr_003');
    // Only the person named by name gets a notice; the words @everyone name nobody.
    expect(await o.noticesTo(sent.message.id)).toEqual(['usr_004']);
    // The push rows are those of any group message (every member pushes in a group): the words add nobody.
    const control = (await o.outbox()).length;
    await o.must('chats.send', { conversationId: group.id, body: `Plain words ${mentionMarkup('Omar Haddad', 'usr_004')}` }, 'usr_003');
    expect((await reached(o, before)).push).toEqual((await reached(o, control)).push);
    expect(JSON.stringify(sent)).not.toContain('usr_002');
    expect(sent.message.body).toBe(body);
  });
});
