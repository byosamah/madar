import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import { Project } from '../contract/entities';
import { ProjectRef } from '../contract/views';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { OWNER_SHAPES } from '../../test/projectShapes';

beforeEach(() => setNow(NOW));

/**
 * The shape of a project picture (owner, 2026-10-26): one SVG path in a box of 18 by 18, drawn in the place of the fixed form. Optional.
 * usr_001 is the Admin, usr_002 leads prj_001 and usr_003 works on it with no right to edit it.
 */
describe('the shape of a project: the contract', () => {
  const base = { ...Project.parse({
    id: 'prj_001', code: 'KH-26-014', name: 'Test Tower', clientId: null, status: 'active', leaderId: null, currentStageId: 'stg_001',
    location: '', areaM2: null, geo: null, startDate: null, targetEndDate: null, contractStartDate: null, coverFileId: null, modelFolderPath: '',
    description: '', healthOverride: null, createdBy: 'usr_001', createdAt: STAMP, updatedAt: STAMP,
  }) };

  it('reads a project with no shape, and takes the three shapes of the owner', () => {
    expect(Project.parse(base).shape).toBeUndefined();
    // An empty text is a project that lost its shape.
    expect(Project.parse({ ...base, shape: '' }).shape).toBe('');
    for (const shape of Object.values(OWNER_SHAPES)) expect(Project.parse({ ...base, shape }).shape).toBe(shape);
  });

  it.each([
    ['a quote', 'M0 0" onload="x'],
    ['an angle bracket', 'M0 0<'],
    ['a letter that is no command', 'M0 0 B1'],
    ['a start that is not M', 'L1 1'],
    ['more than 2000 characters', `M${'1'.repeat(2000)}`],
    ['a space before the M', ' M0 0'],
  ])('refuses %s', (_name, shape) => {
    expect(Project.safeParse({ ...base, shape }).success).toBe(false);
  });

  it('takes a path of exactly 2000 characters', () => {
    expect(Project.safeParse({ ...base, shape: `M${'1'.repeat(1999)}` }).success).toBe(true);
  });

  it('carries the shape in the project reference and the report reference, and keeps the old form without it', () => {
    const ref = { id: 'prj_001', code: 'KH-26-014', name: 'Test Tower', mark: 3 };
    expect(ProjectRef.parse({ ...ref, shape: OWNER_SHAPES.kutla }).shape).toBe(OWNER_SHAPES.kutla);
    expect(ProjectRef.parse(ref)).toEqual(ref);
    expect(ProjectRef.safeParse({ ...ref, shape: 'M0 0<' }).success).toBe(false);
    expect(ProjectRef.safeParse({ ...ref, shape: '' }).success).toBe(false);
  });
});

describe('the shape of a project: projects.update', () => {
  it('sets, changes and clears the shape, and the history records each change', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).project.shape).toBeUndefined();
    const set = await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.madar } });
    expect(set.project.shape).toBe(OWNER_SHAPES.madar);
    const changed = await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.hayyez } });
    expect(changed.project.shape).toBe(OWNER_SHAPES.hayyez);
    const cleared = await t.api.call('projects.update', { id: 'prj_001', patch: { shape: '' } });
    expect(cleared.project.shape ?? '').toBe('');
    const events = Object.values(t.store.state.events).filter((event) => event.verb === 'project.updated' && event.targetId === 'prj_001');
    expect(events).toHaveLength(3);
    expect(events[0].after).toEqual({ shape: OWNER_SHAPES.madar });
  });

  it('writes no event when it clears a shape that was never set, or sets the same shape twice', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const before = Object.keys(t.store.state.events).length;
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: '' } });
    expect(Object.keys(t.store.state.events).length).toBe(before);
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.kutla } });
    const once = Object.keys(t.store.state.events).length;
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.kutla } });
    expect(Object.keys(t.store.state.events).length).toBe(once);
  });

  it('refuses an unsafe or long shape and changes nothing', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    for (const shape of ['M0 0" onload="x', '<svg>', 'L1 1', `M${'1'.repeat(2000)}`]) {
      await expect(t.api.call('projects.update', { id: 'prj_001', patch: { shape } })).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(t.store.state.projects.prj_001.shape).toBeUndefined();
  });

  it('refuses a person who has no right to edit the details, and lets the Admin and the leader in', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.madar } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { shape: '' } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects.prj_001.shape).toBeUndefined();
    t.as('usr_001');
    expect((await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.kutla } })).project.shape).toBe(OWNER_SHAPES.kutla);
  });

  it('takes a shape on an internal project, which is where the owner sets the three', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const made = await t.api.call('projects.create', { name: 'Madar', kind: 'internal' });
    const set = await t.api.call('projects.update', { id: made.project.id, patch: { shape: OWNER_SHAPES.madar } });
    expect(set.project.shape).toBe(OWNER_SHAPES.madar);
  });

  it('undoes a set and a clear, also on a project that had no shape', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.madar } });
    const set = Object.values(t.store.state.events).find((event) => event.verb === 'project.updated')!;
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: '' } });
    const clear = Object.values(t.store.state.events).filter((event) => event.verb === 'project.updated')[1];
    await t.api.call('events.undo', { eventId: clear.id });
    expect(t.store.state.projects.prj_001.shape).toBe(OWNER_SHAPES.madar);
    await t.api.call('events.undo', { eventId: set.id });
    expect(t.store.state.projects.prj_001.shape ?? '').toBe('');
  });
});

describe('the shape of a project: every view that names the project', () => {
  it('is in the detail, the list, the task rows, the chat list, the dashboard and the deadline list', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_001' });
    addProjectConversation(t.store.state, 'prj_001', STAMP);
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.hayyez } });
    const list = await t.api.call('projects.list', { status: 'all', sort: 'name' });
    expect(list.find((row) => row.project.id === 'prj_001')?.project.shape).toBe(OWNER_SHAPES.hayyez);
    const tasks = await t.api.call('tasks.list', { activeProjectsOnly: false });
    expect(tasks.find((task) => task.project?.id === 'prj_001')?.project?.shape).toBe(OWNER_SHAPES.hayyez);
    const chats = await t.api.call('chats.list', {});
    expect(chats.find((chat) => chat.project?.id === 'prj_001')?.project?.shape).toBe(OWNER_SHAPES.hayyez);
    const dash = await t.api.call('dashboard.get', { status: 'active' });
    expect(dash.schedule.find((entry) => entry.project.id === 'prj_001')?.project.shape).toBe(OWNER_SHAPES.hayyez);
  });

  it('leaves the shape out of a reference when the project has none', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const tasks = await t.api.call('tasks.list', { activeProjectsOnly: false });
    for (const task of tasks) if (task.project) expect('shape' in task.project).toBe(false);
  });

  it('is in a notice of a project', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('projects.update', { id: 'prj_001', patch: { shape: OWNER_SHAPES.kutla } });
    t.store.state.notifications.ntf_001 = {
      id: 'ntf_001', userId: 'usr_001', trigger: 'resume_due', actorId: null, targetType: 'project', targetId: 'prj_001', read: false, createdAt: STAMP, dedupeKey: null,
    };
    const notices = await t.api.call('notifications.list', { unreadOnly: false, limit: 100 });
    expect(notices.find((view) => view.notification.id === 'ntf_001')?.project?.shape).toBe(OWNER_SHAPES.kutla);
  });
});
