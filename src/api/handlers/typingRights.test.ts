import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeWorld, NOW, testApi } from '../../test/factories';
import { calls } from '../calls';
import { addDirectConversation } from '../chatState';

beforeEach(() => setNow(NOW));

// Role rights version 2 and chat presence (2026-10-21): a person whose role may not write in a direct or group chat has no message box
// there, so the typing call of that person names nobody.
describe('chats.typing and the right to write', () => {
  it('sends nothing for a person whose role turned off direct and group chats', async () => {
    const t = testApi(calls, makeWorld());
    const room = addDirectConversation(t.store.state, 'usr_002', 'usr_003', '2026-09-30T08:00:00.000+03:00');
    t.as('usr_003');
    expect(await t.api.call('chats.typing', { conversationId: room.id, typing: true })).toEqual({ sent: 1 });
    t.as('usr_001');
    await t.api.call('roles.update', { role: 'member', off: ['chat.direct'] });
    t.as('usr_003');
    expect(await t.api.call('chats.typing', { conversationId: room.id, typing: true })).toEqual({ sent: 0 });
  });
});
