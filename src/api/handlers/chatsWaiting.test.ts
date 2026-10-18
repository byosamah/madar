import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { addProjectConversation } from '../chatState';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';
import { makeTask, NOW, testApi } from '../../test/factories';

/**
 * chats.waiting (fbk_011, owner 2026-10-18): the chats and task threads that wait for the person's reply.
 * - A direct or group chat waits when its newest message came from another person.
 * - A project chat waits when a message that names the person is newer than the person's newest message.
 * - A task thread waits when its newest comment came from another person, and the person leads the task, or a newer
 *   comment of another person names the person with @.
 * A message or comment of the person's agent counts as the person's own. An archived chat does not count. A chat that the
 * person may not open is never in the list.
 */

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls };

// Hala (usr_001) is the Admin, Faisal (usr_002) leads the project, Sara (usr_003) is on the team, Omar (usr_004) is outside,
// and Sara's agent (usr_005) acts for her. tsk_001 is led by Sara, tsk_002 by Faisal.
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', '2026-09-30T09:00:00.000+03:00');
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', createdBy: 'usr_002' });
  return { ...t, room: room.id };
}

/** Moves the clock by some minutes from the start of the test. */
function laterBy(minutes: number): void {
  setNow(new Date(NOW.getTime() + minutes * 60_000));
}

describe('chats.waiting', () => {
  it('lists a direct chat when the newest message came from the other person', async () => {
    const t = world();
    t.as('usr_001');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Is the beam fixed?' });
    t.as('usr_003');
    const rows = await t.api.call('chats.waiting', {});
    expect(rows).toEqual([expect.objectContaining({ kind: 'direct', id, body: 'Is the beam fixed?', days: 0, from: expect.objectContaining({ id: 'usr_001' }) })]);
  });

  it('clears a direct chat when the agent of the person answers', async () => {
    const t = world();
    t.as('usr_001');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Is the beam fixed?' });
    t.as('usr_005');
    await t.api.call('chats.send', { conversationId: id, body: 'Yes, it is fixed.' });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
  });

  it('lists a group for each member except the one who wrote last', async () => {
    const t = world();
    t.as('usr_002');
    const { id } = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_003', 'usr_001'] });
    await t.api.call('chats.send', { conversationId: id, body: 'Drawings are ready.' });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([expect.objectContaining({ kind: 'group', id, title: 'Tower team', from: expect.objectContaining({ id: 'usr_002' }) })]);
    t.as('usr_002');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain(id);
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: id, body: 'Thanks.' });
    t.as('usr_001');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).toContain(id);
    t.as('usr_003');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain(id);
  });

  it('lists a project chat only when a newer message names the person', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: t.room, body: 'The sections are ready.' });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
    laterBy(1);
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Sara Team', 'usr_003')} Please check the sections.` });
    t.as('usr_003');
    const rows = await t.api.call('chats.waiting', {});
    expect(rows).toEqual([expect.objectContaining({ kind: 'project', id: t.room, from: expect.objectContaining({ id: 'usr_002' }) })]);
    // The body is plain text: the mention markup is not shown to an agent.
    expect(rows[0].body).toContain('Please check the sections.');
    expect(rows[0].body).not.toContain('(usr_003)');
    laterBy(2);
    await t.api.call('chats.send', { conversationId: t.room, body: 'Checked.' });
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
  });

  it('lists a task thread for its lead when a newer comment comes from another person', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please check the column.' });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([expect.objectContaining({ kind: 'task', id: 'tsk_001', body: 'Please check the column.' })]);
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Checked.' });
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain('tsk_001');
  });

  it('lists a task thread for a person who is named in a newer comment of another person', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'I will check the wall.' });
    laterBy(1);
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: `${mentionMarkup('Sara Team', 'usr_003')} Please check the wall again.` });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([expect.objectContaining({ kind: 'task', id: 'tsk_002', body: expect.stringContaining('Please check the wall again.') })]);
    // A later comment without a name keeps the thread on the list, with the comment that named the person.
    laterBy(2);
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Thanks.' });
    t.as('usr_003');
    const rows = await t.api.call('chats.waiting', {});
    expect(rows).toEqual([expect.objectContaining({ kind: 'task', id: 'tsk_002', body: expect.stringContaining('Please check the wall again.') })]);
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Done.' });
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain('tsk_002');
  });

  it('does not list a task thread that the person neither leads nor is named in', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'I will check the wall.' });
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Thanks.' });
    t.as('usr_003');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain('tsk_002');
  });

  it('leaves out an archived chat, and lists it again when a newer message comes', async () => {
    const t = world();
    t.as('usr_001');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Is the beam fixed?' });
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: id, archived: true });
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
    laterBy(1);
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: id, body: 'Any news?' });
    t.as('usr_003');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).toEqual([id]);
  });

  it('never lists a chat that the person may not open', async () => {
    const t = world();
    t.as('usr_002');
    const { id } = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_003', 'usr_001'] });
    await t.api.call('chats.send', { conversationId: id, body: 'Drawings are ready.' });
    t.as('usr_001');
    const direct = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: direct.id, body: 'Is the beam fixed?' });
    await t.api.call('chats.send', { conversationId: t.room, body: 'The sections are ready.' });
    t.as('usr_004');
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
  });

  it('gives the days each chat waited, oldest first', async () => {
    const t = world();
    t.as('usr_001');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Is the beam fixed?' });
    laterBy(60);
    t.as('usr_002');
    const group = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_003', 'usr_001'] });
    await t.api.call('chats.send', { conversationId: group.id, body: 'Drawings are ready.' });
    setNow(new Date(NOW.getTime() + 2 * 86_400_000));
    t.as('usr_003');
    const rows = await t.api.call('chats.waiting', {});
    expect(rows.map((row) => [row.kind, row.days])).toEqual([['direct', 2], ['group', 1]]);
  });

  it('is a read: it writes no event and marks no chat read', async () => {
    const t = world();
    t.as('usr_001');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Is the beam fixed?' });
    t.as('usr_003');
    const events = Object.keys(t.store.state.events).length;
    const reads = Object.keys(t.store.state.chatReads).length;
    await t.api.call('chats.waiting', {});
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
    expect(Object.keys(t.store.state.chatReads)).toHaveLength(reads);
    expect(calls['chats.waiting'].readOnly).toBe(true);
  });
});
