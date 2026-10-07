import { beforeEach, describe, expect, it } from 'vitest';
import { contentCalls } from './content';
import { taskCalls } from './tasks';
import { projectCalls } from './projects';
import type { Store } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { mentionMarkup } from '../../lib/text';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

describe('updates', () => {
  it('posts an update and tells the people it mentions', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const item = await t.api.call('updates.create', { projectId: 'prj_001', body: `Please check this ${mentionMarkup('Faisal Leader', 'usr_002')}` });
    expect(item.kind).toBe('update');
    expect(notices(t.store, 'mention', 'usr_002')).toHaveLength(1);
  });

  it('keeps agent posts quiet unless they mention someone', async () => {
    const t = testApi(contentCalls);
    t.as('usr_005');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'Weekly summary: 3 open tasks.' });
    expect(Object.values(t.store.state.notifications)).toHaveLength(0);
    await t.api.call('updates.create', { projectId: 'prj_001', body: `${mentionMarkup('Faisal Leader', 'usr_002')} one task is overdue.` });
    expect(notices(t.store, 'mention', 'usr_002')).toHaveLength(1);
  });

  it("lets a person edit their agent's post", async () => {
    const t = testApi(contentCalls);
    t.as('usr_005');
    const item = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Draft summary.' });
    t.as('usr_003');
    const edited = await t.api.call('updates.update', { id: item.id, body: 'Final summary.' });
    expect(edited.kind === 'update' ? edited.body : '').toBe('Final summary.');
  });

  it('stores the decision flag, and the feed item carries it', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const decided = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Keep the lobby double height.', decision: true });
    expect(decided.kind === 'update' && decided.decision).toBe(true);
    expect(t.store.state.updates[decided.id].decision).toBe(true);
    const plain = await t.api.call('updates.create', { projectId: 'prj_001', body: 'A normal post.' });
    expect(plain.kind === 'update' && 'decision' in plain).toBe(false);
    expect('decision' in t.store.state.updates[plain.id]).toBe(false);
    const notDecided = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Not a decision.', decision: false });
    expect('decision' in t.store.state.updates[notDecided.id]).toBe(false);
    const feed = await t.api.call('updates.list', { projectId: 'prj_001' });
    expect(feed.filter((item) => item.kind === 'update' && item.decision).map((item) => item.id)).toEqual([decided.id]);
  });

  it('stops an outsider from posting', async () => {
    const t = testApi(contentCalls);
    t.as('usr_004');
    await expect(t.api.call('updates.create', { projectId: 'prj_001', body: 'Hello' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets only the author edit, and tells only new mentions', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const item = await t.api.call('updates.create', { projectId: 'prj_001', body: `Hi ${mentionMarkup('Faisal Leader', 'usr_002')}` });
    t.as('usr_002');
    await expect(t.api.call('updates.update', { id: item.id, body: 'Changed' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    const edited = await t.api.call('updates.update', {
      id: item.id, body: `Hi ${mentionMarkup('Faisal Leader', 'usr_002')} and ${mentionMarkup('Hala Admin', 'usr_001')}`,
    });
    expect(edited.kind === 'update' ? edited.editedAt : null).not.toBeNull();
    expect(notices(t.store, 'mention', 'usr_002')).toHaveLength(1);
    expect(notices(t.store, 'mention', 'usr_001')).toHaveLength(1);
  });

  it('filters the feed', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'Site visit done.' });
    expect(await t.api.call('updates.list', { projectId: 'prj_001', filter: 'posts' })).toHaveLength(1);
    expect(await t.api.call('updates.list', { projectId: 'prj_001', filter: 'tasks' })).toHaveLength(0);
  });

  it('lists only the decisions with the decisions filter (owner, 2026-10-03)', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'Site visit done.' });
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'Keep the lobby double height.', decision: true });
    const decisions = await t.api.call('updates.list', { projectId: 'prj_001', filter: 'decisions' });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'update', body: 'Keep the lobby double height.', decision: true });
  });
});

describe('comments', () => {
  it('adds, lists, reacts and protects edits', async () => {
    const t = testApi(contentCalls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_003');
    const first = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Started.' });
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Thanks.' });
    const list = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(list.map((c) => c.comment.body)).toEqual(['Started.', 'Thanks.']);
    expect((await t.api.call('reactions.toggle', { commentId: first.comment.id, emoji: '👍' })).comment.reactions['👍']).toEqual(['usr_002']);
    expect((await t.api.call('reactions.toggle', { commentId: first.comment.id, emoji: '👍' })).comment.reactions['👍']).toEqual([]);
    await expect(t.api.call('comments.update', { id: first.comment.id, body: 'Edited' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a comment on a missing task', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    await expect(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_404', body: 'Hi' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('rights on posts and comments', () => {
  it('tells the viewer which posts and comments they may edit', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Mine' });
    const comment = await t.api.call('comments.create', { targetType: 'update', targetId: post.id, body: 'Note' });
    expect(post).toMatchObject({ kind: 'update', canEdit: true });
    expect(comment.canEdit).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('updates.list', { projectId: 'prj_001', filter: 'posts' }))[0]).toMatchObject({ canEdit: false });
    expect((await t.api.call('comments.list', { targetType: 'update', targetId: post.id }))[0].canEdit).toBe(false);
  });

  it('tells the viewer which agent changes in the feed they may undo (spec 10.7)', async () => {
    const t = testApi({ ...contentCalls, ...taskCalls });
    t.as('usr_005');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Agent task' });
    const agentItem = async () => (await t.api.call('updates.list', { projectId: 'prj_001', filter: 'tasks' }))
      .find((item) => item.kind === 'event' && item.author.id === 'usr_005');
    // The agent acted for Sara Team. Undoing a new task needs the right to delete it: Sara made it, so she holds that right on it,
    // and the leader holds it on every task (owner, 2026-10-07). An outsider does not.
    t.as('usr_003');
    expect(await agentItem()).toMatchObject({ canUndo: true });
    t.as('usr_002');
    expect(await agentItem()).toMatchObject({ canUndo: true });
    t.as('usr_004');
    expect(await agentItem()).toMatchObject({ canUndo: false });
  });

  it('offers no Undo on a change the API cannot undo', async () => {
    const t = testApi({ ...contentCalls, ...projectCalls });
    t.store.state.users.usr_005.ownerId = 'usr_001';
    t.as('usr_005');
    const detail = await t.api.call('projects.create', { name: 'Agent project', leader: 'usr_002' });
    t.as('usr_002');
    const created = (await t.api.call('updates.list', { projectId: detail.project.id, filter: 'all' }))
      .find((item) => item.kind === 'event' && item.verb === 'project.created');
    expect(created).toMatchObject({ canUndo: false });
  });
});
