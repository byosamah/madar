import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { State } from '../../src/api/store';
import { liteWriteState } from '../data/lite/whole';
import { freshLite } from '../data/lite/testDb';
import { fakeDeps } from '../test/fakes/deps';
import { sendChatPush } from './notify';
import { makeVapidKeys, type VapidConfig } from './vapid';

/**
 * The push after the wait on SQLite (chat design item 20): the same rule as PUSH_STILL_NEW_SQL on Postgres, run on node:sqlite.
 * A direct message msg_901 by usr_001 in cnv_013 at T. usr_002 has one push device.
 */
const TODAY = '2026-10-19';
const T = '2026-10-19T09:00:00.000+03:00';
const LATER = '2026-10-19T09:01:00.000+03:00';
const PUSH = 'https://fcm.googleapis.com/fcm/send/chat-device';

let vapid: VapidConfig;
beforeEach(async () => {
  vapid = { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function office(edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  seed.pushDevices = { pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH, label: 'Phone', createdAt: T, lastPushAt: null } };
  seed.conversations.cnv_013 = { id: 'cnv_013', kind: 'direct', projectId: null, memberIds: ['usr_001', 'usr_002'], createdAt: T };
  const base = Object.values(seed.messages)[0];
  seed.messages.msg_901 = { ...base, id: 'msg_901', conversationId: 'cnv_013', authorId: 'usr_001', actingForId: 'usr_001', createdAt: T } as State['messages'][string];
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db, config: { push: vapid } });
  // 11:00 in Riyadh on a Monday: inside the default work hours, so quiet hours hold nothing back.
  deps.clock.set(new Date('2026-10-19T08:00:00Z'));
  const posts: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    posts.push(url);
    return new Response(null, { status: 201 });
  }));
  return { deps, posts };
}

const items = [{ chatId: 'cnv_013', itemId: 'msg_901' }];

describe('sendChatPush on SQLite', () => {
  it('on SQLite, pushes a message that the person did not read', async () => {
    const { deps, posts } = await office();
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(posts).toEqual([PUSH]);
  });

  it('on SQLite, skips a chat that the person read after the message', async () => {
    const { deps, posts } = await office((seed) => {
      seed.chatReads = { 'cnv_013:usr_002': { conversationId: 'cnv_013', userId: 'usr_002', lastReadAt: LATER } };
    });
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(posts).toEqual([]);
  });

  it('on SQLite, still pushes a chat that the person read before the message', async () => {
    const { deps, posts } = await office((seed) => {
      seed.chatReads = { 'cnv_013:usr_002': { conversationId: 'cnv_013', userId: 'usr_002', lastReadAt: '2026-10-19T08:00:00.000+03:00' } };
    });
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(posts).toEqual([PUSH]);
  });

  it('on SQLite, skips a deleted message and a comment that is gone', async () => {
    const deleted = await office((seed) => {
      seed.messages.msg_901 = { ...seed.messages.msg_901, deletedAt: LATER } as State['messages'][string];
    });
    await sendChatPush({ userId: 'usr_002', items }, deleted.deps);
    expect(deleted.posts).toEqual([]);
    const gone = await office();
    await sendChatPush({ userId: 'usr_002', items: [{ chatId: 'tsk_001', itemId: 'cmt_999' }] }, gone.deps);
    expect(gone.posts).toEqual([]);
  });

  it('on SQLite, pushes a task comment that the person did not read, and skips it after a read of the thread', async () => {
    const unread = await office((seed) => {
      seed.comments.cmt_901 = { id: 'cmt_901', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_001', body: 'Done.', reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: T, editedAt: null } as State['comments'][string];
    });
    const comment = [{ chatId: 'tsk_001', itemId: 'cmt_901' }];
    await sendChatPush({ userId: 'usr_002', items: comment }, unread.deps);
    expect(unread.posts).toEqual([PUSH]);
    const read = await office((seed) => {
      seed.comments.cmt_901 = { id: 'cmt_901', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_001', body: 'Done.', reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: T, editedAt: null } as State['comments'][string];
      seed.chatReads = { 'tsk_001:usr_002': { conversationId: 'tsk_001', userId: 'usr_002', lastReadAt: LATER } };
    });
    await sendChatPush({ userId: 'usr_002', items: comment }, read.deps);
    expect(read.posts).toEqual([]);
  });
});
