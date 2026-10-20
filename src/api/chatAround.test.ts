import { describe, expect, it } from 'vitest';
import { addGroupConversation } from './chatState';
import { AROUND_BEFORE, messagePageAround } from './chatAround';
import { makeWorld, STAMP } from '../test/factories';
import { nextId } from './store';

/** The page that holds one message (chat design 2026-10-19, item 17), on a state, with no handler. */
function room(n: number) {
  const state = makeWorld();
  const chat = addGroupConversation(state, 'Find', 'usr_002', ['usr_002', 'usr_003', 'usr_004'], STAMP).id;
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = nextId(state, 'msg');
    const createdAt = new Date(Date.UTC(2026, 8, 30, 6) + i * 60_000).toISOString();
    state.messages[id] = { id, conversationId: chat, authorId: 'usr_003', actingForId: 'usr_003', body: `Line ${i}`, mentions: [], createdAt, editedAt: null };
    ids.push(id);
  }
  return { state, chat, ids };
}

describe('messagePageAround', () => {
  it('keeps 20 messages before the target', () => {
    expect(AROUND_BEFORE).toBe(20);
  });

  it('gives the newest page when the message is in it', () => {
    const { state, chat, ids } = room(250);
    const found = messagePageAround(state, chat, 200, ids[239])!;
    expect(found.page.map((m) => m.id)).toEqual(ids.slice(50));
    expect(found.newer).toBe(false);
  });

  it('starts 20 messages before an older message and runs to the end when 500 are enough', () => {
    const { state, chat, ids } = room(250);
    const found = messagePageAround(state, chat, 200, ids[29])!;
    expect(found.page.map((m) => m.id)).toEqual(ids.slice(9));
    expect(found.newer).toBe(false);
  });

  it('cuts at 500 messages and says that newer messages exist', () => {
    const { state, chat, ids } = room(600);
    const found = messagePageAround(state, chat, 200, ids[49])!;
    expect(found.page.map((m) => m.id)).toEqual(ids.slice(29, 529));
    expect(found.newer).toBe(true);
  });

  it('starts at the first message when fewer than 20 come before it', () => {
    const { state, chat, ids } = room(600);
    expect(messagePageAround(state, chat, 200, ids[4])!.page[0].id).toBe(ids[0]);
  });

  it('gives null for a deleted target, a message of another chat and an unknown id', () => {
    const { state, chat, ids } = room(30);
    state.messages[ids[5]].deletedAt = STAMP;
    expect(messagePageAround(state, chat, 200, ids[5])).toBeNull();
    const other = addGroupConversation(state, 'Other', 'usr_002', ['usr_002', 'usr_003', 'usr_004'], STAMP).id;
    expect(messagePageAround(state, other, 200, ids[7])).toBeNull();
    expect(messagePageAround(state, chat, 200, 'msg_999')).toBeNull();
  });
});
