import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import { ApiError } from '../errors';
import { chatReadKey } from '../store';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A chat that the person may not open answers not_found, whatever its kind (chat design 2026-10-19, item 17). Hala (usr_001) is the
 * Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is outside. A forbidden answer told an outsider
 * that the id of a direct or project chat exists.
 */
async function world() {
  const t = testApi({ ...chatCalls, ...contentCalls, ...projectCalls });
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
  t.as('usr_003');
  const direct = (await t.api.call('chats.openDirect', { userId: 'usr_002' })).id;
  const m = (await t.api.call('chats.send', { conversationId: direct, body: 'A private line 8812' })).message.id;
  return { ...t, room, direct, m };
}

const probes = (id: string, around: string) => [
  ['chats.messages', { conversationId: id }], ['chats.messages', { conversationId: id, around }],
  ['chats.send', { conversationId: id, body: 'Hi' }], ['chats.markRead', { conversationId: id }],
  ['chats.archive', { conversationId: id, archived: true }],
] as const;

async function errorOf(attempt: Promise<unknown>): Promise<ApiError> {
  try {
    await attempt;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('The call had to fail.');
}

describe('a chat that the person may not open answers not_found', () => {
  it('answers a direct chat of two other people as a chat that does not exist, on every chat call, the Admin too', async () => {
    const t = await world();
    for (const person of ['usr_004', 'usr_001']) {
      t.as(person);
      for (const [name, input] of probes(t.direct, t.m)) {
        await expect(t.api.call(name, input as never)).rejects.toMatchObject({ code: 'not_found', message: `Conversation ${t.direct} does not exist.` });
      }
    }
  });

  it('answers a project chat off the team the same way, and the team and the Admin still open it', async () => {
    const t = await world();
    t.as('usr_004');
    for (const [name, input] of probes(t.room, t.m)) {
      await expect(t.api.call(name, input as never)).rejects.toMatchObject({ code: 'not_found', message: `Conversation ${t.room} does not exist.` });
    }
    for (const person of ['usr_003', 'usr_001', 'usr_002']) {
      t.as(person);
      expect((await t.api.call('chats.messages', { conversationId: t.room })).chat.kind).toBe('project');
    }
  });

  it('gives a hidden chat the same answer as an id that was never made', async () => {
    const t = await world();
    t.as('usr_004');
    const hidden = await errorOf(t.api.call('chats.messages', { conversationId: t.direct }));
    const never = await errorOf(t.api.call('chats.messages', { conversationId: 'cnv_999' }));
    expect({ ...hidden, message: hidden.message.replace(t.direct, 'X'), details: undefined }).toEqual({ ...never, message: never.message.replace('cnv_999', 'X'), details: undefined });
    expect(JSON.stringify(hidden)).not.toContain('8812');
  });

  it('writes no read mark and no message for the refused person', async () => {
    const t = await world();
    t.as('usr_004');
    await errorOf(t.api.call('chats.markRead', { conversationId: t.direct }));
    await errorOf(t.api.call('chats.send', { conversationId: t.room, body: 'Let me in' }));
    expect(t.store.state.chatReads[chatReadKey(t.direct, 'usr_004')]).toBeUndefined();
    expect(Object.values(t.store.state.messages).some((m) => m.body === 'Let me in')).toBe(false);
  });
});
