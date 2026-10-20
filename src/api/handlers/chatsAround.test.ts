import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { nextId } from '../store';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * chats.messages with "around" (chat design 2026-10-19, item 17): the page that holds one message, also when it is older than the
 * first page. A group of usr_002, usr_003 and usr_004 holds the messages "Line 1" to "Line n", one minute apart.
 */
async function world() {
  const t = testApi(chatCalls);
  t.as('usr_002');
  const { id: group } = await t.api.call('chats.createGroup', { memberIds: ['usr_003', 'usr_004'] });
  const ids: string[] = [];
  function fill(n: number): void {
    for (let i = 1; i <= n; i++) {
      const id = nextId(t.store.state, 'msg');
      const createdAt = new Date(Date.UTC(2026, 8, 30, 6) + i * 60_000).toISOString();
      t.store.state.messages[id] = { id, conversationId: group, authorId: 'usr_003', actingForId: 'usr_003', body: `Line ${i}`, mentions: [], createdAt, editedAt: null };
      ids.push(id);
    }
  }
  return { t, group, ids, fill };
}

describe('chats.messages opens at one message', () => {
  it('opens the newest page when the message is in it', async () => {
    const { t, group, ids, fill } = await world();
    fill(250);
    const page = await t.api.call('chats.messages', { conversationId: group, around: ids[239] });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(50));
    expect(page.newer).toBe(false);
  });

  it('opens 20 messages before an older message and every newer one, up to 500 in all', async () => {
    const { t, group, ids, fill } = await world();
    fill(250);
    const page = await t.api.call('chats.messages', { conversationId: group, around: ids[29] });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(9));
    expect(page.newer).toBe(false);
  });

  it('cuts the page at 500 messages and says that newer messages exist', async () => {
    const { t, group, ids, fill } = await world();
    fill(600);
    const page = await t.api.call('chats.messages', { conversationId: group, around: ids[49] });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(29, 529));
    expect(page.newer).toBe(true);
  });

  it('starts at the first message when fewer than 20 come before it', async () => {
    const { t, group, ids, fill } = await world();
    fill(600);
    expect((await t.api.call('chats.messages', { conversationId: group, around: ids[4] })).messages[0].message.id).toBe(ids[0]);
  });

  it('gives the newest page with no error for a message of another chat, a deleted message or an unknown id', async () => {
    const { t, group, ids, fill } = await world();
    fill(250);
    const other = (await t.api.call('chats.openDirect', { userId: 'usr_003' })).id;
    const foreign = (await t.api.call('chats.send', { conversationId: other, body: 'Not for the group 4471' })).message.id;
    t.store.state.messages[ids[10]].deletedAt = STAMP;
    for (const around of [foreign, ids[10], 'msg_999']) {
      const page = await t.api.call('chats.messages', { conversationId: group, around });
      expect(page.messages.at(-1)?.message.id).toBe(ids[249]);
      expect(page.newer).toBe(false);
      expect(JSON.stringify(page)).not.toContain('Not for the group 4471');
    }
  });

  it('refuses around and before together', async () => {
    const { t, group, ids, fill } = await world();
    fill(3);
    await expect(t.api.call('chats.messages', { conversationId: group, around: ids[1], before: ids[2] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps newer false and the plain page when no around is given', async () => {
    const { t, group, ids, fill } = await world();
    fill(250);
    const page = await t.api.call('chats.messages', { conversationId: group });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(50));
    expect(page.newer).toBe(false);
  });
});
