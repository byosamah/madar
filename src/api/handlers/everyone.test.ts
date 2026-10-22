import { beforeEach, describe, expect, it } from 'vitest';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import { calls } from '../calls';
import { memberKey } from '../store';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';
import { NOW, STAMP, makeProject, makeTask, makeUser, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/**
 * @everyone, @all and @الجميع (owner, 2026-10-22, fbk_041). The office: Hala (usr_001) is the Admin. Faisal (usr_002) leads prj_001. Sara
 * (usr_003) and Nour (usr_006) are on its team. Layla (usr_007) is on the team but turned off. Omar (usr_004) is outside every place.
 * usr_005 is the agent of Sara. Rami (usr_008) leads prj_002, a project with no part in these chats.
 */
function world() {
  const t = testApi(calls);
  const s = t.store.state;
  s.users.usr_006 = makeUser('usr_006', { name: 'Nour Team' });
  s.users.usr_007 = makeUser('usr_007', { name: 'Layla Off', active: false });
  s.users.usr_008 = makeUser('usr_008', { name: 'Rami Other Leader' });
  s.counters.usr = 8;
  s.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Other Tower', leaderId: 'usr_008' });
  for (const userId of ['usr_006', 'usr_007']) s.members[memberKey('prj_001', userId)] = { projectId: 'prj_001', userId, discipline: 'Architect' };
  const room = addProjectConversation(s, 'prj_001', STAMP);
  const group = addGroupConversation(s, 'Site visit', 'usr_003', ['usr_003', 'usr_002', 'usr_006', 'usr_007'], STAMP);
  const direct = addDirectConversation(s, 'usr_003', 'usr_002', STAMP);
  return { t, s, room: room.id, group: group.id, direct: direct.id };
}

type World = ReturnType<typeof world>;

/** The people who hold an unread notice that points to a message or a comment, with the flags of the notice. */
function noticesOf(w: World, messageId: string) {
  return Object.values(w.s.notifications)
    .filter((n) => n.messageId === messageId)
    .map((n) => ({ userId: n.userId, everyone: n.everyone === true, reply: n.reply === true }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

async function say(w: World, as: string, conversationId: string, body: string, extra: Record<string, unknown> = {}) {
  w.t.as(as);
  return w.t.api.call('chats.send', { conversationId, body, ...extra });
}

const withoutSwitch = (w: World, role: 'member' | 'management' = 'member') => {
  w.s.settings.roles = { off: { [role]: ['chat.mentionEveryone'] } };
};

describe('@everyone in a group', () => {
  it('names every member except the sender and a person who is turned off, with a notice that carries the flag', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.group, 'Please come at 9 @everyone');
    expect(noticesOf(w, sent.message.id)).toEqual([{ userId: 'usr_002', everyone: true, reply: false }, { userId: 'usr_006', everyone: true, reply: false }]);
    expect(w.s.messages[sent.message.id].mentions).toEqual(['usr_002', 'usr_006']);
  });

  it('reads @all and @الجميع the same, in any case', async () => {
    const w = world();
    for (const body of ['@all see this', 'See this @ALL', 'مرحبا @الجميع', 'Ready @Everyone!']) {
      const sent = await say(w, 'usr_003', w.group, body);
      expect(noticesOf(w, sent.message.id).map((n) => n.userId), body).toEqual(['usr_002', 'usr_006']);
    }
  });

  it('marks the message as naming each of them, and not the sender', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.group, '@everyone');
    w.t.as('usr_002');
    const thread = await w.t.api.call('chats.messages', { conversationId: w.group });
    expect(thread.messages.find((m) => m.message.id === sent.message.id)!.namesMe).toBe(true);
    w.t.as('usr_003');
    expect((await w.t.api.call('chats.messages', { conversationId: w.group })).messages.find((m) => m.message.id === sent.message.id)!.namesMe).toBe(false);
  });

  it('gives one notice to a person who is named by name too, and the notice is the plain mention', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.group, `${mentionMarkup('Faisal Leader', 'usr_002')} and @everyone`);
    expect(noticesOf(w, sent.message.id)).toEqual([{ userId: 'usr_002', everyone: false, reply: false }, { userId: 'usr_006', everyone: true, reply: false }]);
  });

  it('gives one notice to the author of the old message in a reply, and that notice is the reply', async () => {
    const w = world();
    const first = await say(w, 'usr_002', w.group, 'Where do we meet?');
    const sent = await say(w, 'usr_003', w.group, 'At the site @everyone', { replyToId: first.message.id });
    expect(noticesOf(w, sent.message.id)).toEqual([{ userId: 'usr_002', everyone: false, reply: true }, { userId: 'usr_006', everyone: true, reply: false }]);
  });

  it('is plain text for a person who lacks "Mention everyone": no notice, no name in the list', async () => {
    const w = world();
    withoutSwitch(w);
    const sent = await say(w, 'usr_003', w.group, 'Please come @everyone');
    expect(noticesOf(w, sent.message.id)).toEqual([]);
    expect(w.s.messages[sent.message.id].mentions).toEqual([]);
    expect(sent.message.body).toBe('Please come @everyone');
  });

  it('names nobody in an email address or a longer word', async () => {
    const w = world();
    for (const body of ['write to x@all.com', 'ask @allison']) {
      const sent = await say(w, 'usr_003', w.group, body);
      expect(noticesOf(w, sent.message.id), body).toEqual([]);
    }
  });

  it('names an agent writer\'s group by the rights and the person of the agent: the person is not in the list', async () => {
    const w = world();
    const sent = await say(w, 'usr_005', w.group, 'Hello @all');
    expect(noticesOf(w, sent.message.id).map((n) => n.userId)).toEqual(['usr_002', 'usr_006']);
  });
});

describe('@everyone in a project chat', () => {
  it('names the leader and the team, never the sender, a turned-off person, or an Admin who is not on the team', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.room, '@everyone design review at noon');
    expect(noticesOf(w, sent.message.id).map((n) => n.userId)).toEqual(['usr_002', 'usr_006']);
  });

  it('names the team only when a holder of chat.project.all outside the team writes', async () => {
    const w = world();
    const sent = await say(w, 'usr_001', w.room, '@all hello team');
    expect(noticesOf(w, sent.message.id).map((n) => n.userId)).toEqual(['usr_002', 'usr_003', 'usr_006']);
  });

  it('gives a notice that a press opens at the message', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.room, '@everyone');
    const notice = Object.values(w.s.notifications).find((n) => n.messageId === sent.message.id && n.userId === 'usr_002')!;
    expect(notice).toMatchObject({ trigger: 'mention', targetType: 'chat', targetId: w.room, everyone: true, read: false });
  });
});

describe('@everyone in a direct chat', () => {
  it('names nobody', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.direct, 'Hi @everyone');
    expect(noticesOf(w, sent.message.id)).toEqual([]);
    expect(w.s.messages[sent.message.id].mentions).toEqual([]);
  });
});

describe('@everyone in a to-do thread', () => {
  function withTask(w: World, over: Partial<ReturnType<typeof makeTask>> = {}) {
    w.s.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', createdBy: 'usr_002', helperIds: ['usr_006'], ...over });
  }
  const comment = async (w: World, as: string, body: string, taskId = 'tsk_001') => {
    w.t.as(as);
    return w.t.api.call('comments.create', { targetType: 'task', targetId: taskId, body });
  };

  it('names the lead, the helpers, the maker and the project leader, and not the other people of the team', async () => {
    const w = world();
    withTask(w, { createdBy: 'usr_004' });
    const made = await comment(w, 'usr_001', 'Please look @everyone');
    expect(noticesOf(w, made.comment.id).map((n) => n.userId)).toEqual(['usr_002', 'usr_003', 'usr_004', 'usr_006']);
    expect(w.s.comments[made.comment.id].mentions).toEqual(['usr_002', 'usr_003', 'usr_004', 'usr_006']);
  });

  it('never names the sender, and keeps the flag on the notice', async () => {
    const w = world();
    withTask(w);
    const made = await comment(w, 'usr_003', '@all quick update');
    expect(noticesOf(w, made.comment.id)).toEqual([{ userId: 'usr_002', everyone: true, reply: false }, { userId: 'usr_006', everyone: true, reply: false }]);
  });

  it('marks the comment as naming each person, through the list kept on the comment', async () => {
    const w = world();
    withTask(w);
    const made = await comment(w, 'usr_003', '@everyone');
    w.t.as('usr_006');
    const list = await w.t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(list.find((c) => c.comment.id === made.comment.id)!.namesMe).toBe(true);
    w.t.as('usr_003');
    expect((await w.t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' })).find((c) => c.comment.id === made.comment.id)!.namesMe).toBe(false);
  });

  it('names the people of an office to-do: the maker, the lead and the helpers, and not the leader of another project', async () => {
    const w = world();
    withTask(w, { projectId: null, stageId: null as never, createdBy: 'usr_004', ownerId: 'usr_003', helperIds: ['usr_006'] });
    const made = await comment(w, 'usr_003', 'Done @everyone');
    expect(noticesOf(w, made.comment.id).map((n) => n.userId)).toEqual(['usr_004', 'usr_006']);
  });

  it('names no person without the switch', async () => {
    const w = world();
    withTask(w);
    withoutSwitch(w);
    const made = await comment(w, 'usr_003', '@everyone');
    expect(noticesOf(w, made.comment.id)).toEqual([]);
    expect(w.s.comments[made.comment.id].mentions).toBeUndefined();
  });

  it('gives one notice to a person who is named by name too', async () => {
    const w = world();
    withTask(w);
    const made = await comment(w, 'usr_003', `${mentionMarkup('Nour Team', 'usr_006')} @everyone`);
    expect(noticesOf(w, made.comment.id)).toEqual([{ userId: 'usr_002', everyone: true, reply: false }, { userId: 'usr_006', everyone: false, reply: false }]);
  });

  it('gives a reply author the reply notice only', async () => {
    const w = world();
    withTask(w);
    const first = await comment(w, 'usr_006', 'Question?');
    w.t.as('usr_003');
    const answer = await w.t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Answer @everyone', replyToId: first.comment.id });
    expect(noticesOf(w, answer.comment.id)).toEqual([{ userId: 'usr_002', everyone: true, reply: false }, { userId: 'usr_006', everyone: false, reply: true }]);
  });
});

describe('an edit and a restore', () => {
  it('names the people for the first time only when an edit adds the words, and takes the notices away when an edit removes them', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.group, 'Please come');
    expect(noticesOf(w, sent.message.id)).toEqual([]);
    w.t.as('usr_003');
    await w.t.api.call('chats.editMessage', { id: sent.message.id, body: 'Please come @everyone' });
    expect(noticesOf(w, sent.message.id).map((n) => n.userId)).toEqual(['usr_002', 'usr_006']);
    // A second edit that keeps the words sends no second notice.
    w.s.notifications = Object.fromEntries(Object.entries(w.s.notifications).map(([key, n]) => [key, { ...n, read: true }]));
    await w.t.api.call('chats.editMessage', { id: sent.message.id, body: 'Please come @all, at nine' });
    expect(Object.values(w.s.notifications).filter((n) => n.messageId === sent.message.id && !n.read)).toEqual([]);
    await w.t.api.call('chats.editMessage', { id: sent.message.id, body: 'Please come at nine' });
    expect(noticesOf(w, sent.message.id)).toEqual([]);
    expect(w.s.messages[sent.message.id].mentions).toEqual([]);
  });

  it('gives the notices back, already read, when a deleted message comes back', async () => {
    const w = world();
    const sent = await say(w, 'usr_003', w.group, '@everyone');
    w.t.as('usr_003');
    await w.t.api.call('chats.deleteMessage', { id: sent.message.id });
    expect(noticesOf(w, sent.message.id)).toEqual([]);
    await w.t.api.call('chats.deleteMessage', { id: sent.message.id, deleted: false });
    const back = Object.values(w.s.notifications).filter((n) => n.messageId === sent.message.id);
    expect(back.map((n) => [n.userId, n.everyone === true, n.read])).toEqual([['usr_002', true, true], ['usr_006', true, true]]);
  });

  it('names the people of a comment for the first time when an edit adds the words', async () => {
    const w = world();
    w.s.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', createdBy: 'usr_002', helperIds: ['usr_006'] });
    w.t.as('usr_003');
    const made = await w.t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Update' });
    await w.t.api.call('comments.update', { id: made.comment.id, body: 'Update @everyone' });
    expect(noticesOf(w, made.comment.id).map((n) => n.userId)).toEqual(['usr_002', 'usr_006']);
    expect(w.s.comments[made.comment.id].mentions).toEqual(['usr_002', 'usr_006']);
  });
});

describe('the Admin copies', () => {
  it('make no copy of an @everyone notice', async () => {
    const w = world();
    w.s.users.usr_001 = { ...w.s.users.usr_001, preferences: { ...w.s.users.usr_001.preferences, adminReach: 'all' } };
    const sent = await say(w, 'usr_003', w.room, '@everyone');
    expect(Object.values(w.s.notifications).filter((n) => n.messageId === sent.message.id && n.userId === 'usr_001')).toEqual([]);
  });
});

describe('the switch Mention everyone', () => {
  it('is on for Member, Management and Accounting by default, and the Admin holds it', async () => {
    const { rightsOf } = await import('../rights');
    for (const role of ['member', 'management', 'accounting'] as const) {
      expect(rightsOf(makeUser('usr_050', { systemRole: role }), undefined)).toContain('chat.mentionEveryone');
    }
    expect(rightsOf(makeUser('usr_050', { systemRole: 'admin' }), undefined)).toContain('chat.mentionEveryone');
  });

  it('can be turned off for a role, and then the words are plain text for that role only', async () => {
    const w = world();
    w.s.users.usr_006 = { ...w.s.users.usr_006, systemRole: 'management' };
    withoutSwitch(w, 'management');
    const off = await say(w, 'usr_006', w.group, '@everyone');
    expect(noticesOf(w, off.message.id)).toEqual([]);
    const on = await say(w, 'usr_003', w.group, '@everyone');
    expect(noticesOf(w, on.message.id).length).toBe(2);
  });
});

describe('the count of people that @everyone names (the row Everyone of the mention list)', () => {
  it('is given by chats.messages for a group and a project chat, without the sender and the people who are off', async () => {
    const w = world();
    w.t.as('usr_003');
    expect((await w.t.api.call('chats.messages', { conversationId: w.group })).everyone).toBe(2);
    expect((await w.t.api.call('chats.messages', { conversationId: w.room })).everyone).toBe(2);
    w.t.as('usr_001');
    // The Admin is not on the team and reads the project chat: the team is named, the Admin is the sender.
    expect((await w.t.api.call('chats.messages', { conversationId: w.room })).everyone).toBe(3);
  });

  it('is not given for a direct chat, nor to a person without "Mention everyone"', async () => {
    const w = world();
    w.t.as('usr_003');
    expect((await w.t.api.call('chats.messages', { conversationId: w.direct })).everyone).toBeUndefined();
    withoutSwitch(w);
    expect((await w.t.api.call('chats.messages', { conversationId: w.group })).everyone).toBeUndefined();
  });

  it('is given by tasks.get for the people of the to-do, and not for a person without the switch', async () => {
    const w = world();
    w.s.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', createdBy: 'usr_002', helperIds: ['usr_006'] });
    w.t.as('usr_003');
    expect((await w.t.api.call('tasks.get', { id: 'tsk_001' })).everyone).toBe(2);
    w.t.as('usr_002');
    expect((await w.t.api.call('tasks.get', { id: 'tsk_001' })).everyone).toBe(2);
    withoutSwitch(w);
    w.t.as('usr_003');
    expect((await w.t.api.call('tasks.get', { id: 'tsk_001' })).everyone).toBeUndefined();
  });
});
