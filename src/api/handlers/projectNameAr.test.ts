import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The Arabic name of a project (owner, 2026-10-26, fbk_062: "add a field for project's name in arabic also"). Optional. An empty value
 * means none. Every view that names a project carries it, and Search finds a project by either name. usr_001 is the Admin and
 * leads or works on prj_001.
 */
const NAME_AR = 'برج الكورنيش للمكاتب';

describe('the Arabic name of a project', () => {
  it('is saved by projects.create, trimmed, and comes back in the detail and the list', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const made = await t.api.call('projects.create', { name: 'Harbor Villa', nameAr: `  ${NAME_AR}  `, subCompanyId: undefined });
    expect(made.project.nameAr).toBe(NAME_AR);
    const list = await t.api.call('projects.list', { status: 'all', sort: 'name' });
    expect(list.find((row) => row.project.id === made.project.id)?.project.nameAr).toBe(NAME_AR);
    expect((await t.api.call('projects.get', { id: made.project.id })).project.nameAr).toBe(NAME_AR);
  });

  it('is left out of the record when projects.create gets none or an empty value', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const none = await t.api.call('projects.create', { name: 'No Arabic' });
    const empty = await t.api.call('projects.create', { name: 'Empty Arabic', nameAr: '   ' });
    expect(none.project.nameAr).toBeUndefined();
    expect(empty.project.nameAr).toBeUndefined();
  });

  it('refuses a name over 120 characters', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await expect(t.api.call('projects.create', { name: 'Long', nameAr: 'ا'.repeat(121) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: 'ا'.repeat(121) } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('is set, changed and cleared by projects.update, and the history records each change', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).project.nameAr).toBeUndefined();
    const set = await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: NAME_AR } });
    expect(set.project.nameAr).toBe(NAME_AR);
    const changed = await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: 'برج جديد' } });
    expect(changed.project.nameAr).toBe('برج جديد');
    const cleared = await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: '' } });
    expect(cleared.project.nameAr ?? '').toBe('');
    const events = Object.values(t.store.state.events).filter((event) => event.verb === 'project.updated' && event.targetId === 'prj_001');
    expect(events).toHaveLength(3);
  });

  it('writes no event when projects.update clears a name that was never set', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const before = Object.keys(t.store.state.events).length;
    await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: '' } });
    expect(Object.keys(t.store.state.events).length).toBe(before);
  });

  it('shows in every view that names the project', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_001' });
    addProjectConversation(t.store.state, 'prj_001', STAMP);
    await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: NAME_AR } });
    const tasks = await t.api.call('tasks.list', { activeProjectsOnly: false });
    const row = tasks.find((task) => task.project?.id === 'prj_001');
    expect(row?.project?.nameAr).toBe(NAME_AR);
    const chats = await t.api.call('chats.list', {});
    expect(chats.find((chat) => chat.project?.id === 'prj_001')?.project?.nameAr).toBe(NAME_AR);
    const dash = await t.api.call('dashboard.get', { status: 'active' });
    expect(dash.schedule.find((entry) => entry.project.id === 'prj_001')?.project.nameAr).toBe(NAME_AR);
  });

  it('is found by Search in Arabic, and the English name still finds the project', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: NAME_AR } });
    const arabic = await t.api.call('search.query', { text: 'الكورنيش' });
    expect(arabic.projects.map((project) => project.id)).toEqual(['prj_001']);
    expect(arabic.projects[0].nameAr).toBe(NAME_AR);
    const english = await t.api.call('search.query', { text: 'Tower' });
    expect(english.projects.map((project) => project.id)).toContain('prj_001');
  });

  it('gives a notice of a project the Arabic name of the project', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('projects.update', { id: 'prj_001', patch: { nameAr: NAME_AR } });
    t.store.state.notifications.ntf_001 = {
      id: 'ntf_001', userId: 'usr_001', trigger: 'resume_due', actorId: null, targetType: 'project', targetId: 'prj_001', read: false, createdAt: STAMP, dedupeKey: null,
    };
    const notices = await t.api.call('notifications.list', { unreadOnly: false, limit: 100 });
    const notice = notices.find((view) => view.notification.id === 'ntf_001');
    expect(notice?.target).toBe('Test Tower');
    expect(notice?.targetAr).toBe(NAME_AR);
    expect(notice?.project?.nameAr).toBe(NAME_AR);
  });
});
