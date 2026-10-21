import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, User } from '../../src/api/contract/entities';
import { canSeeConversation } from '../../src/api/chatState';
import { mentionMarkup } from '../../src/lib/text';
import { processOutbox } from '../core/effects';
import { createRunCall, runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { PUSH_CHAT_EFFECT, PUSH_DEVICES_SQL, PUSH_EFFECT } from '../push/notify';
import { makeVapidKeys } from '../push/vapid';
// It registers the push effect and the push producers, as server/core/deps.ts does for the entries.
import '../push/effects';
import '../mail/effects';
import { newBatch, NOW, startOffice, type ItOffice } from './runCallOffice';

/**
 * Browser push on the local database (owner, 2026-10-08), as madar_server: the three device calls, the unique endpoint, the
 * producer SQL (a new notice by the id of the open transaction, a new message by its id), the effect, a gone device, a retry and
 * the privacy of a device. No push leaves the Mac: the fetch of the push service is a stub. It needs the local stack and the
 * Docker lock.
 */

const SECRET_TITLE = 'Confidential facade study for the tower';
const FCM = 'https://fcm.googleapis.com/fcm/send/';
const endpointOf = (id: string) => `${FCM}token-of-${id}`;

type Live = ReturnType<ItOffice['isolate']>;

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

describe('browser push on the local database, as madar_server', () => {
  let office: ItOffice;
  let deps: Live;
  let leader: string;
  let project: Project;
  let members: User[];
  let answers: Record<string, number>;
  let posted: { url: string; init: RequestInit }[];

  const call = (as: string, name: string, input: unknown, d: Live = deps) => runCall(d, { principal: { userId: as }, name, input, batch: newBatch() });
  const register = async (userId: string, endpoint = endpointOf(userId)) =>
    okOf(await call(userId, 'push.register', { endpoint, label: 'Chrome on Mac' }));
  // Both kinds: push.notify (a plain notice, at once) and push.chat (a chat message or a task comment, after the wait; with no host the
  // rows of a test run before the answer, with no wait).
  const outboxOf = () => office.sql<{ payload: { userId: string }; done: boolean; error: string | null }>(
    'select payload, done_at is not null as done, error from outbox where kind = any($1::text[]) order by id', [[PUSH_EFFECT, PUSH_CHAT_EFFECT]],
  );
  const pushedTo = () => posted.map((entry) => entry.url).sort();

  beforeAll(async () => {
    office = await startOffice('push');
    const keys = await makeVapidKeys();
    const isolate = office.isolate();
    deps = Object.assign(isolate, { config: { ...isolate.config, push: { ...keys, subject: 'mailto:madar@vado.sa' } } });
    const seed = office.seed;
    project = Object.values(seed.projects).find((p) => p.status === 'active' && p.leaderId && seed.users[p.leaderId]?.active)!;
    leader = project.leaderId!;
    const ids = new Set(Object.values(seed.members).filter((m) => m.projectId === project.id).map((m) => m.userId));
    members = [...ids].map((id) => seed.users[id]).filter((u) => u && u.id !== leader && u.active && u.kind === 'human');
    expect(members.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  beforeEach(async () => {
    await office.sql('truncate push_devices, outbox');
    answers = {};
    posted = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      posted.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: answers[String(url)] ?? 201 });
    }));
    deps.signal.sent.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await office?.close();
  });

  it('keeps one row for one endpoint in the table, moves it to the next person, and keeps ten devices at most', async () => {
    const [sara, omar] = members;
    await register(sara.id, endpointOf('shared'));
    await register(omar.id, endpointOf('shared'));
    const rows = await office.sql<{ id: string; user_id: string; endpoint: string }>('select id, user_id, endpoint from push_devices order by ord');
    expect(rows).toEqual([{ id: expect.any(String), user_id: omar.id, endpoint: endpointOf('shared') }]);
    for (let i = 1; i <= 11; i += 1) await register(sara.id, endpointOf(`sara-${i}`));
    const own = okOf<{ endpoint: string }[]>(await call(sara.id, 'push.mine', {}));
    expect(own).toHaveLength(10);
    expect(own.map((d) => d.endpoint)).not.toContain(endpointOf('sara-1'));
    expect(own.map((d) => d.endpoint)).toContain(endpointOf('sara-11'));
  });

  it('writes no event and no change signal for a device, and no push row', async () => {
    const [sara] = members;
    const events = await office.sql<{ n: number }>('select count(*)::integer as n from events');
    await register(sara.id);
    okOf(await call(sara.id, 'push.remove', { endpoint: endpointOf(sara.id) }));
    expect(await office.sql('select count(*)::integer as n from events')).toEqual(events);
    expect(deps.signal.sent).toEqual([]);
    expect(await outboxOf()).toEqual([]);
  });

  it('pushes to the devices of the lead of a new task, once, after the commit, with an empty body and no client data', async () => {
    const [sara, omar] = members;
    await register(sara.id, endpointOf('sara-a'));
    await register(sara.id, endpointOf('sara-b'));
    await register(omar.id);
    okOf(await call(leader, 'tasks.create', { projectId: project.id, title: SECRET_TITLE, ownerId: sara.id }));
    expect(await outboxOf()).toEqual([{ payload: { userId: sara.id }, done: true, error: null }]);
    expect(pushedTo()).toEqual([endpointOf('sara-a'), endpointOf('sara-b')]);
    for (const { init } of posted) {
      expect(init.method).toBe('POST');
      expect(init.body ?? null).toBeNull();
      expect(JSON.stringify(init.headers)).not.toContain(SECRET_TITLE);
    }
    const stamps = await office.sql<{ at: string | null }>("select doc->>'lastPushAt' as at from push_devices where user_id = $1", [sara.id]);
    expect(stamps.every((row) => row.at !== null)).toBe(true);
    expect(await office.sql<{ at: string | null }>("select doc->>'lastPushAt' as at from push_devices where user_id = $1", [omar.id])).toEqual([{ at: null }]);
  });

  it('pushes a project chat message only to the people it names, never to its sender, and a direct message to the other member (item 19)', async () => {
    const seed = office.seed;
    const conversation = Object.values(seed.conversations).find((c) => c.kind === 'project' && c.projectId === project.id)!;
    const sender = members[0];
    const named = members[1];
    const everyone = Object.values(seed.users).filter((u) => u.kind === 'human' && u.active);
    for (const user of everyone) await register(user.id);
    okOf(await call(sender.id, 'chats.send', { conversationId: conversation.id, body: 'Update for the team' }));
    expect(pushedTo()).toEqual([]);
    okOf(await call(sender.id, 'chats.send', { conversationId: conversation.id, body: `${mentionMarkup(named.name, named.id)} please look` }));
    expect(pushedTo()).toEqual([endpointOf(named.id)]);
    expect((await outboxOf()).map((row) => row.payload.userId)).toEqual([named.id]);

    posted.length = 0;
    await office.sql('truncate outbox');
    const [a, b] = members;
    const direct = okOf<{ id: string }>(await call(a.id, 'chats.openDirect', { userId: b.id }));
    okOf(await call(a.id, 'chats.send', { conversationId: direct.id, body: 'Hello' }));
    expect(pushedTo()).toEqual([endpointOf(b.id)]);
  });

  it('pushes a plain task comment to the task lead, and not to the author or a third person (item 19)', async () => {
    const [sara, omar, third] = members;
    for (const user of [sara, omar, third]) await register(user.id);
    const { task } = okOf<{ task: { id: string } }>(await call(leader, 'tasks.create', { projectId: project.id, title: 'A task for Sara', ownerId: sara.id }));
    posted.length = 0;
    await office.sql('truncate outbox');
    okOf(await call(omar.id, 'comments.create', { targetType: 'task', targetId: task.id, body: 'A plain note.' }));
    expect(pushedTo()).toEqual([endpointOf(sara.id)]);
    expect((await outboxOf()).map((row) => row.payload.userId)).toEqual([sara.id]);
  });

  it('sends no push for a direct message that the other person read before the push ran (item 20)', async () => {
    const [a, b] = members;
    await register(b.id);
    const direct = okOf<{ id: string }>(await call(a.id, 'chats.openDirect', { userId: b.id }));
    posted.length = 0;
    await office.sql('truncate outbox');
    // The rows are held, as on a host with after: the push runs 10 seconds later, here after the read.
    const held: string[] = [];
    const sendHeld = createRunCall({ afterCommit: async (_deps, ids) => void held.push(...ids) });
    okOf(await sendHeld(deps, { principal: { userId: a.id }, name: 'chats.send', input: { conversationId: direct.id, body: 'Read me soon' }, batch: newBatch() }));
    expect(held).toHaveLength(1);
    okOf(await call(b.id, 'chats.markRead', { conversationId: direct.id }));
    await processOutbox(deps, held);
    expect(posted).toEqual([]);
    // A message that the person did not read still pushes after the wait. The office clock stands still in this test, so it moves one
    // minute: a message with the same stamp as the read mark counts as read.
    deps.clock.set(new Date(NOW.getTime() + 60_000));
    held.length = 0;
    okOf(await sendHeld(deps, { principal: { userId: a.id }, name: 'chats.send', input: { conversationId: direct.id, body: 'Unread this time' }, batch: newBatch() }));
    await processOutbox(deps, held);
    expect(pushedTo()).toEqual([endpointOf(b.id)]);
    deps.clock.set(NOW);
  });

  it('pushes a group message to the other people of the group, and to nobody outside it (2026-10-18)', async () => {
    const [a, b, c] = members;
    const outsider = members.find((u) => u.id !== a.id && u.id !== b.id && u.id !== c.id);
    await register(b.id);
    await register(c.id);
    posted.length = 0;
    await office.sql('truncate outbox');
    const group = okOf<{ id: string }>(await call(a.id, 'chats.createGroup', { name: 'Push team', memberIds: [b.id, c.id] }));
    okOf(await call(a.id, 'chats.send', { conversationId: group.id, body: 'Group hello' }));
    expect(pushedTo()).toEqual([endpointOf(b.id), endpointOf(c.id)].sort());
    expect(pushedTo()).not.toContain(endpointOf(a.id));
    if (outsider) expect(pushedTo()).not.toContain(endpointOf(outsider.id));
  });

  it('writes no push row for a person with no device', async () => {
    const [sara, omar] = members;
    await register(omar.id);
    okOf(await call(leader, 'tasks.create', { projectId: project.id, title: 'For Sara', ownerId: sara.id }));
    expect(await outboxOf()).toEqual([]);
    expect(posted).toEqual([]);
    // The device of an active human is the only one the effect reads.
    expect(await office.sql(PUSH_DEVICES_SQL, [sara.id])).toEqual([]);
    // A device saved with no keys reads keys null: it gets the empty push (owner, 2026-10-21).
    expect(await office.sql(PUSH_DEVICES_SQL, [omar.id])).toEqual([{ endpoint: endpointOf(omar.id), keys: null }]);
  });

  it('leaves no push row after a call that fails', async () => {
    const [sara] = members;
    await register(sara.id);
    const failed = await call(leader, 'tasks.create', { projectId: project.id, title: '', ownerId: sara.id });
    expect(failed.ok).toBe(false);
    expect(await outboxOf()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('removes a device that the push service calls gone, and keeps a row with an error for a 503 so the job tries again', async () => {
    const [sara] = members;
    await register(sara.id, endpointOf('gone'));
    await register(sara.id, endpointOf('busy'));
    await register(sara.id, endpointOf('fine'));
    answers[endpointOf('gone')] = 410;
    answers[endpointOf('busy')] = 503;
    okOf(await call(leader, 'tasks.create', { projectId: project.id, title: 'A task', ownerId: sara.id }));
    const left = await office.sql<{ endpoint: string; at: string | null }>("select endpoint, doc->>'lastPushAt' as at from push_devices order by ord");
    expect(left.map((row) => row.endpoint)).toEqual([endpointOf('busy'), endpointOf('fine')]);
    expect(left.find((row) => row.endpoint === endpointOf('fine'))!.at).not.toBeNull();
    const [row] = await outboxOf();
    expect(row.done).toBe(false);
    expect(row.error).toMatch(/fcm\.googleapis\.com answered 503/);
    expect(row.error).not.toContain('token-of-');
  });

  it('shows a device only to its person: the Admin, the History, the search and the Realtime signals hold no endpoint', async () => {
    const [sara, omar] = members;
    const admin = Object.values(office.seed.users).find((u) => u.kind === 'human' && u.active && u.systemRole === 'admin')!;
    await register(sara.id, endpointOf('private-sara'));
    await register(omar.id, endpointOf('private-omar'));
    okOf(await call(leader, 'tasks.create', { projectId: project.id, title: 'A task', ownerId: sara.id }));
    const seen = [
      await call(admin.id, 'push.mine', {}), await call(omar.id, 'push.mine', {}), await call(admin.id, 'events.list', { limit: 500 }),
      await call(admin.id, 'search.query', { text: 'private' }), await call(admin.id, 'notifications.list', {}), await call(admin.id, 'chats.list', {}),
    ];
    const text = JSON.stringify(seen) + JSON.stringify(deps.signal.sent);
    expect(text).not.toContain('private-sara');
    expect(text.split('private-omar').length - 1).toBe(1);
    expect(okOf<unknown[]>(seen[0])).toEqual([]);
    const moved = await call(admin.id, 'push.remove', { endpoint: endpointOf('private-sara') });
    expect(okOf(moved)).toEqual({ removed: false });
    expect(await office.sql('select count(*)::integer as n from push_devices')).toEqual([{ n: 2 }]);
  });
});
