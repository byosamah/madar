import { beforeEach, describe, expect, it } from 'vitest';
import { contentCalls } from './content';
import { taskCalls } from './tasks';
import type { RoleSettings } from '../contract/entities';
import { makeTask, NOW, testApi } from '../../test/factories';
import { without as off, withExtra as extra } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Posts and comments of role rights version 2 (design 5.4). post.create, comment.create (also reactions), post.editOwn.
 * People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member, usr_004 outside the team, usr_005 agent of usr_003.
 */
const calls = { ...contentCalls, ...taskCalls };

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', createdBy: 'usr_002' });
  t.store.state.counters.tsk = 1;
  if (roles) t.store.state.settings.roles = roles;
  return t;
}

describe('post.create: a post in a project', () => {
  it('passes for the team with the switch on, and refuses with it off', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('updates.create', { projectId: 'prj_001', body: 'Hello' })).kind).toBe('update');
    const closed = world(off('post.create.team'));
    closed.as('usr_003');
    await expect(closed.api.call('updates.create', { projectId: 'prj_001', body: 'Hello' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the agent of a person without the switch, and the outsider with the team switch', async () => {
    const closed = world(off('post.create.team'));
    closed.as('usr_005');
    await expect(closed.api.call('updates.create', { projectId: 'prj_001', body: 'Hello' })).rejects.toMatchObject({ code: 'forbidden' });
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('updates.create', { projectId: 'prj_001', body: 'Hello' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader post through the team switch (the leader counts as on the team), and an outsider post with the all switch', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'From the leader' });
    const all = world(extra('post.create.all'));
    all.as('usr_004');
    await all.api.call('updates.create', { projectId: 'prj_001', body: 'From outside' });
  });

  it('keeps the comment open when only the post is off', async () => {
    const t = world(off('post.create.team'));
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'A comment' });
  });
});

describe('comment.create: comments and reactions', () => {
  it('passes with the switch on, and refuses a comment and a reaction with it off', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Hi' });
    await t.api.call('reactions.toggle', { commentId: made.comment.id, emoji: '👍' });
    const closed = world(off('comment.create.team'));
    closed.as('usr_002');
    const first = await closed.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Leader' }).catch((e) => e);
    // The leader counts as on the team, so the team switch off closes the leader too.
    expect(first).toMatchObject({ code: 'forbidden' });
    closed.as('usr_003');
    await expect(closed.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Hi' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a reaction with the switch off', async () => {
    const t = world();
    t.as('usr_002');
    const made = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Hi' });
    t.store.state.settings.roles = off('comment.create.team');
    t.as('usr_003');
    await expect(t.api.call('reactions.toggle', { commentId: made.comment.id, emoji: '👍' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('reactions.toggle', { commentId: made.comment.id, emoji: '👍' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the people of an office to-do comment with the switch on, and refuses them with it off', async () => {
    const t = world();
    t.as('usr_003');
    const office = (await t.api.call('tasks.create', { title: 'Office', ownerId: 'usr_003' })).task;
    await t.api.call('comments.create', { targetType: 'task', targetId: office.id, body: 'Note' });
    t.store.state.settings.roles = off('comment.create.team');
    await expect(t.api.call('comments.create', { targetType: 'task', targetId: office.id, body: 'Note' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('post.editOwn: edit and delete your own post or comment', () => {
  it('passes for the author with the switch on, and refuses with it off', async () => {
    const t = world();
    t.as('usr_003');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'First' });
    const comment = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Note' });
    await t.api.call('updates.update', { id: post.id, body: 'Second' });
    await t.api.call('comments.update', { id: comment.comment.id, body: 'Note 2' });
    t.store.state.settings.roles = off('post.editOwn');
    await expect(t.api.call('updates.update', { id: post.id, body: 'Third' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('updates.delete', { id: post.id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('comments.update', { id: comment.comment.id, body: 'Note 3' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('comments.delete', { id: comment.comment.id })).rejects.toMatchObject({ code: 'forbidden' });
    // The flags follow the same switch.
    expect((await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' }))[0].canEdit).toBe(false);
  });

  it('refuses another person, the leader included, and the agent of a person without the switch', async () => {
    const t = world();
    t.as('usr_003');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'First' });
    t.as('usr_002');
    await expect(t.api.call('updates.update', { id: post.id, body: 'Mine now' })).rejects.toMatchObject({ code: 'forbidden' });
    t.store.state.settings.roles = off('post.editOwn');
    t.as('usr_005');
    await expect(t.api.call('updates.update', { id: post.id, body: 'By agent' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
