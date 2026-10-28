import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectMember } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { mentionMarkup } from '../../src/lib/text';
import type { Deps } from '../core/ports';
import { createRunCall, type RunCall } from '../core/runCall';
import { liteData } from '../data/lite/callData';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { releaseHeld } from './held';
import { PUSH_HOLD_LITE, sendChatPush, sendPushNotify } from './notify';
import { base64url, makeVapidKeys } from './vapid';

/**
 * A push planned before the person loses the view of its project (hidden projects, owner 2026-10-22; task tsk_439). The producer plans
 * a push with the view rule at save time. The effect runs later: push.chat waits, a row may retry, and the 15-minute job retries. In
 * between, the person may lose the view (taken off the team, the project hidden). The effect then sends nothing to any device, with or
 * without keys, and the row ends as done: the browser must not show "You have something new in Madar." about a project that the
 * person cannot open. A person who still views gets the push, also the empty one when the line cannot be made.
 *
 * The tests run the real calls on a real SQLite office. usr_004 is a Member who works on prj_001 (leader usr_002) through a team row
 * that the test adds. usr_001 is the Admin. Every text that names the project is a secret for a person who lost the view.
 */

const PERSON = 'usr_004';
const PUSH = 'https://fcm.googleapis.com/fcm/send/aa';
const STAMP = '2026-10-04T09:00:00.000+03:00';
/** Sunday 2026-10-04, 09:00 in Riyadh: work hours. */
const MORNING = new Date('2026-10-04T06:00:00Z');
/** Sunday 19:00 in Riyadh: quiet hours. */
const EVENING = new Date('2026-10-04T16:00:00Z');
/** Monday 09:00 in Riyadh: the quiet hours are over. */
const NEXT = new Date('2026-10-05T06:00:00Z');
const SECRET_WORDS = 'Secret hidden words 7731';
const SECRET_TASK = 'Secret hidden task title 7731';

type Keys = { p256dh: string; auth: string };
let keys: Keys;
let seed: State;
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  keys = {
    p256dh: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)),
    auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type Posted = { url: string; body: unknown };

/** An office where the person works on prj_001 and holds one device. Messages, comments and notices start empty: the test makes its own. */
async function office(o: { keyed: boolean; at?: Date }) {
  const lite = await freshLite();
  const edit = structuredClone(seed);
  edit.messages = {};
  edit.comments = {};
  edit.notifications = {};
  const member: ProjectMember = { projectId: 'prj_001', userId: PERSON, discipline: 'Architect' } as ProjectMember;
  edit.members[`prj_001:${PERSON}`] = member;
  edit.pushDevices = { pdv_901: { id: 'pdv_901', userId: PERSON, endpoint: PUSH, label: 'Phone', createdAt: STAMP, lastPushAt: null, ...(o.keyed ? { keys } : {}) } };
  await lite.db.tx('write', (q) => liteWriteState(q, edit));
  const vapid = { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' };
  const deps = fakeDeps({ db: lite.db, config: { push: vapid } });
  deps.clock.set(o.at ?? MORNING);
  const posted: Posted[] = [];
  deps.pushFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posted.push({ url: String(input), body: init?.body });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  const run = createRunCall({ data: liteData });
  const call = async <T>(userId: string, name: string, input: unknown): Promise<T> => {
    const result = await run(deps as unknown as Deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
    return result.output as T;
  };
  return { ...lite, deps, posted, run, call };
}
type World = Awaited<ReturnType<typeof office>>;

/** What the producer plans for the person: one notice (push.notify), one chat message and one task comment (push.chat). */
async function plan(w: World) {
  await w.call('usr_001', 'tasks.update', { id: 'tsk_009', patch: { ownerId: PERSON, title: SECRET_TASK } });
  const name = seed.users[PERSON].name;
  const sent = await w.call<{ message: { id: string } }>('usr_001', 'chats.send', { conversationId: 'cnv_001', body: `${mentionMarkup(name, PERSON)} ${SECRET_WORDS}` });
  const comment = await w.call<{ comment: { id: string } }>('usr_001', 'comments.create', { targetType: 'task', targetId: 'tsk_009', body: `${SECRET_WORDS} in the thread` });
  return { messageItem: { chatId: 'cnv_001', itemId: sent.message.id }, commentItem: { chatId: 'tsk_009', itemId: comment.comment.id } };
}

/** The person loses the view: the project becomes hidden, the open to-do goes back to the leader, and the person leaves the team. */
async function loseView(w: World) {
  await w.call('usr_001', 'tasks.update', { id: 'tsk_009', patch: { ownerId: 'usr_002' } });
  await w.call('usr_001', 'projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] });
  await w.call('usr_001', 'members.remove', { projectId: 'prj_001', userId: PERSON });
}

const logText = (w: World) => JSON.stringify(w.deps.logs);
const bodyText = (w: World) => JSON.stringify(w.posted.map((one) => (one.body instanceof Uint8Array ? Array.from(one.body) : one.body ?? null)));

describe.each([{ keyed: true }, { keyed: false }])('a push planned before the view is lost (device with keys: $keyed)', ({ keyed }) => {
  it('push.notify: the person views, then loses the view: no post to the device, and the row ends as done', async () => {
    const w = await office({ keyed });
    await plan(w);
    await sendPushNotify({ userId: PERSON }, w.deps, { run: w.run });
    expect(w.posted).toHaveLength(1);
    w.posted.length = 0;
    await loseView(w);
    await expect(sendPushNotify({ userId: PERSON }, w.deps, { run: w.run })).resolves.toBeUndefined();
    expect(w.posted).toEqual([]);
    expect(logText(w)).not.toContain(SECRET_TASK);
  });

  it('push.chat of a project chat message: no post after the view is lost, and the row ends as done', async () => {
    const w = await office({ keyed });
    const { messageItem } = await plan(w);
    await sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: w.run });
    expect(w.posted).toHaveLength(1);
    w.posted.length = 0;
    await loseView(w);
    await expect(sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: w.run })).resolves.toBeUndefined();
    expect(w.posted).toEqual([]);
    expect(logText(w)).not.toContain(SECRET_WORDS);
  });

  it('push.chat of a task comment: no post after the view is lost, and the row ends as done', async () => {
    const w = await office({ keyed });
    const { commentItem } = await plan(w);
    await sendChatPush({ userId: PERSON, items: [commentItem] }, w.deps, { run: w.run });
    expect(w.posted).toHaveLength(1);
    w.posted.length = 0;
    await loseView(w);
    await expect(sendChatPush({ userId: PERSON, items: [commentItem] }, w.deps, { run: w.run })).resolves.toBeUndefined();
    expect(w.posted).toEqual([]);
    expect(logText(w)).not.toContain(SECRET_WORDS);
  });

  it('push.chat with items of two chats: the item of the chat that the person still opens still pushes', async () => {
    const w = await office({ keyed });
    const { messageItem } = await plan(w);
    const group = await w.call<{ id: string }>('usr_001', 'chats.createGroup', { name: 'Site team', memberIds: [PERSON, 'usr_002'] });
    const sent = await w.call<{ message: { id: string } }>('usr_001', 'chats.send', { conversationId: group.id, body: 'Group words for everyone.' });
    await loseView(w);
    await sendChatPush({ userId: PERSON, items: [{ chatId: group.id, itemId: sent.message.id }, messageItem].sort((a, b) => a.itemId.localeCompare(b.itemId)) }, w.deps, { run: w.run });
    expect(w.posted).toHaveLength(1);
  });
});

describe('the person still views the project', () => {
  it('(c) push.notify, push.chat of a message and push.chat of a comment send the normal push, with the line for a device with keys', async () => {
    const w = await office({ keyed: true });
    const { messageItem, commentItem } = await plan(w);
    await sendPushNotify({ userId: PERSON }, w.deps, { run: w.run });
    await sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: w.run });
    await sendChatPush({ userId: PERSON, items: [commentItem] }, w.deps, { run: w.run });
    expect(w.posted).toHaveLength(3);
    for (const one of w.posted) expect(one.body, 'an encrypted line').toBeInstanceOf(Uint8Array);
  });

  it('(c) sends the empty push to a device with no keys, and no read throws', async () => {
    const w = await office({ keyed: false });
    const { messageItem } = await plan(w);
    await sendPushNotify({ userId: PERSON }, w.deps, { run: w.run });
    await sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: w.run });
    expect(w.posted.map((one) => one.body)).toEqual([undefined, undefined]);
  });

  it('(b) sends the empty push when the line fails for another reason than "gone", with or without keys', async () => {
    for (const keyed of [true, false]) {
      for (const failure of ['throw', 'failed'] as const) {
        const w = await office({ keyed });
        const { messageItem } = await plan(w);
        const broken: RunCall = async () => {
          if (failure === 'throw') throw new Error(`The database is away. ${SECRET_WORDS}`);
          return { ok: false, error: { code: 'failed', message: `Something broke. ${SECRET_WORDS}` } } as never;
        };
        await sendPushNotify({ userId: PERSON }, w.deps, { run: broken });
        await sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: broken });
        expect(w.posted.map((one) => one.body), `${keyed} ${failure}`).toEqual([undefined, undefined]);
        // The log names the kind of the error, never its text.
        expect(logText(w)).not.toContain(SECRET_WORDS);
      }
    }
  });
});

describe('outsider probes: a person who lost the view learns nothing on any path of the push effects', () => {
  it('posts no body, and logs no word of the project, on every effect and every device form', async () => {
    for (const keyed of [true, false]) {
      const w = await office({ keyed });
      const { messageItem, commentItem } = await plan(w);
      await loseView(w);
      await sendPushNotify({ userId: PERSON }, w.deps, { run: w.run });
      await sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: w.run });
      await sendChatPush({ userId: PERSON, items: [commentItem] }, w.deps, { run: w.run });
      await sendChatPush({ userId: PERSON, items: [messageItem, commentItem] }, w.deps, { run: w.run });
      expect(w.posted, `keys ${keyed}`).toEqual([]);
      expect(bodyText(w)).not.toContain(SECRET_WORDS);
      expect(logText(w)).not.toMatch(/Secret hidden/);
    }
  });

  it('keeps every read as the person, and reads nothing as another person', async () => {
    const w = await office({ keyed: false });
    const { messageItem } = await plan(w);
    await loseView(w);
    const asked: string[] = [];
    const watch: RunCall = async (d, req) => {
      asked.push(`${req.principal.userId} ${req.name}`);
      return w.run(d, req);
    };
    await sendPushNotify({ userId: PERSON }, w.deps, { run: watch });
    await sendChatPush({ userId: PERSON, items: [messageItem] }, w.deps, { run: watch });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((one) => one.startsWith(`${PERSON} `))).toBe(true);
  });
});

describe('the quiet end of a person who lost the view', () => {
  async function held(keyed: boolean) {
    const w = await office({ keyed, at: EVENING });
    const { messageItem } = await plan(w);
    await loseView(w);
    await w.db.statement('write', PUSH_HOLD_LITE, [PERSON, STAMP]);
    w.deps.clock.set(NEXT);
    return { w, messageItem };
  }

  it('sends nothing when the only unread items are in the project, and clears the mark', async () => {
    for (const keyed of [true, false]) {
      const { w } = await held(keyed);
      expect(await releaseHeld(w.deps, NEXT, { run: w.run }), `keys ${keyed}`).toEqual({ held: 1, pushed: 0, cleared: 1 });
      expect(w.posted).toEqual([]);
    }
  });

  it('still sends the fixed line when the person has another unread item that they may open', async () => {
    const { w } = await held(false);
    const group = await w.call<{ id: string }>('usr_001', 'chats.createGroup', { name: 'Site team', memberIds: [PERSON, 'usr_002'] });
    await w.call('usr_001', 'chats.send', { conversationId: group.id, body: 'Group words for everyone.' });
    expect(await releaseHeld(w.deps, NEXT, { run: w.run })).toEqual({ held: 1, pushed: 1, cleared: 1 });
    expect(w.posted.map((one) => one.body)).toEqual([undefined]);
  });
});
