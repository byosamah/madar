import { beforeEach, describe, expect, it } from 'vitest';
import { contentCalls } from './content';
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
