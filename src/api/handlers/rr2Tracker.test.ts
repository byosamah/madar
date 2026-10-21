import { beforeEach, describe, expect, it } from 'vitest';
import { fileCalls } from './files';
import { trackerCalls } from './tracker';
import { taskCalls } from './tasks';
import type { RoleSettings } from '../contract/entities';
import { memberKey } from '../store';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { both, without as off, withExtra as extra } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The Client Tracker gates of role rights version 2 (design 5.7): tracker.log (also close, update and the Balady tick), tracker.reply,
 * tracker.export, tracker.deleteOwn and tracker.deleteAny. People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member,
 * usr_004 outside the team, usr_005 agent of usr_003, usr_006 team member.
 */
const calls = { ...trackerCalls, ...taskCalls, ...fileCalls };
const ENTRY = { projectId: 'prj_001', type: 'message', direction: 'in', title: 'Client asks' } as const;
const REPLY = { ...ENTRY, waiting: 'us', replyBy: { userId: 'usr_006', dueDate: '2026-10-10' } } as const;

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Third Member' });
  t.store.state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  if (roles) t.store.state.settings.roles = roles;
  return t;
}

describe('tracker.log: log, update and close', () => {
  it('passes for the team with the switch on, and refuses all three with it off', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', { ...ENTRY, waiting: 'client' });
    await t.api.call('tracker.update', { id: row.entry.id, note: 'More' });
    await t.api.call('tracker.close', { id: row.entry.id });
    t.store.state.settings.roles = off('tracker.log.team');
    await expect(t.api.call('tracker.log', ENTRY)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tracker.update', { id: row.entry.id, note: 'Again' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tracker.close', { id: row.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the agent of a person without the switch, and an outsider with only the team switch', async () => {
    const closed = world(off('tracker.log.team'));
    closed.as('usr_005');
    await expect(closed.api.call('tracker.log', ENTRY)).rejects.toMatchObject({ code: 'forbidden' });
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('tracker.log', ENTRY)).rejects.toMatchObject({ code: 'forbidden' });
    const all = world(extra('tracker.log.all'));
    all.as('usr_004');
    await all.api.call('tracker.log', ENTRY);
  });

  it('shows the flags: canEdit and canClose follow the switch', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tracker.log', { ...ENTRY, waiting: 'client' });
    t.store.state.settings.roles = off('tracker.log.team');
    const [row] = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(row).toMatchObject({ canEdit: false, canClose: false });
  });
});

describe('tracker.reply: Ask to reply', () => {
  it('opens the reply to-do with the switches on, for the person or for another person', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', REPLY);
    expect(row.replyTask?.owner?.id).toBe('usr_006');
    const open = await t.api.call('tracker.log', { ...ENTRY, waiting: 'us' });
    const assigned = await t.api.call('tracker.assignReply', { id: open.entry.id, userId: 'usr_003', dueDate: '2026-10-10' });
    expect(assigned.replyTask?.owner?.id).toBe('usr_003');
  });

  it('refuses replyBy and assignReply with tracker.reply off', async () => {
    const t = world(off('tracker.reply'));
    t.as('usr_003');
    await expect(t.api.call('tracker.log', REPLY)).rejects.toMatchObject({ code: 'forbidden' });
    const open = await t.api.call('tracker.log', { ...ENTRY, waiting: 'us' });
    await expect(t.api.call('tracker.assignReply', { id: open.entry.id, userId: 'usr_003', dueDate: '2026-10-10' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('tracker.assignReply', { id: open.entry.id, userId: 'usr_003', dueDate: '2026-10-10' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('also needs the right to add a to-do, and the right to name another person', async () => {
    const noAdd = world(off('task.add.team'));
    noAdd.as('usr_003');
    await expect(noAdd.api.call('tracker.log', REPLY)).rejects.toMatchObject({ code: 'forbidden' });
    const noAssign = world(off('task.assign'));
    noAssign.as('usr_003');
    await expect(noAssign.api.call('tracker.log', REPLY)).rejects.toMatchObject({ code: 'forbidden' });
    // A reply to-do for yourself needs no switch to name people.
    const own = await noAssign.api.call('tracker.log', { ...ENTRY, waiting: 'us', replyBy: { userId: 'usr_003', dueDate: '2026-10-10' } });
    expect(own.replyTask?.owner?.id).toBe('usr_003');
  });
});

describe('close and update that finish a reply to-do', () => {
  it('pass with task.work, and refuse without it', async () => {
    const on = world();
    on.as('usr_002');
    const row = await on.api.call('tracker.log', REPLY);
    on.as('usr_003');
    const closed = await on.api.call('tracker.close', { id: row.entry.id });
    expect(closed.replyTask?.status).toBe('done');
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('tracker.log', REPLY);
    t.store.state.settings.roles = off('task.work');
    await expect(t.api.call('tracker.close', { id: made.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tracker.update', { id: made.entry.id, waiting: 'client' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tracker.list', { projectId: 'prj_001' }))[0].canClose).toBe(false);
    t.as('usr_005');
    await expect(t.api.call('tracker.close', { id: made.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader close through task.any when task.work is off', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('tracker.log', REPLY);
    t.store.state.settings.roles = off('task.work');
    t.as('usr_002');
    const closed = await t.api.call('tracker.close', { id: made.entry.id });
    expect(closed.replyTask?.status).toBe('done');
  });

  it('closes an entry with no reply to-do without task.work', async () => {
    const t = world(off('task.work'));
    t.as('usr_003');
    const made = await t.api.call('tracker.log', { ...ENTRY, waiting: 'client' });
    expect((await t.api.call('tracker.close', { id: made.entry.id })).entry.closedAt).not.toBeNull();
  });
});

describe('tracker.export', () => {
  it('passes with the switch on and refuses with it off, for the person and the agent', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tracker.export', { projectId: 'prj_001' });
    t.store.state.settings.roles = off('tracker.export');
    await expect(t.api.call('tracker.export', { projectId: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('tracker.export', { projectId: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('tracker.deleteOwn and tracker.deleteAny', () => {
  it('lets the author delete with the switch on, and refuses with it off', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', ENTRY);
    await t.api.call('tracker.delete', { id: row.entry.id });
    const made = await t.api.call('tracker.log', ENTRY);
    t.store.state.settings.roles = off('tracker.deleteOwn');
    await expect(t.api.call('tracker.delete', { id: made.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tracker.list', { projectId: 'prj_001' }))[0].canDelete).toBe(false);
    t.as('usr_005');
    await expect(t.api.call('tracker.delete', { id: made.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses another team member', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', ENTRY);
    t.as('usr_006');
    await expect(t.api.call('tracker.delete', { id: row.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader delete any entry with the lead switch, and refuses with it off', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', ENTRY);
    t.as('usr_002');
    await t.api.call('tracker.delete', { id: row.entry.id });
    const closed = world(off('tracker.deleteAny.lead'));
    closed.as('usr_003');
    const made = await closed.api.call('tracker.log', ENTRY);
    closed.as('usr_002');
    await expect(closed.api.call('tracker.delete', { id: made.entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets a holder of the all switch delete an entry of a project outside the team', async () => {
    const t = world(both([], ['tracker.deleteAny.all']));
    t.as('usr_003');
    const row = await t.api.call('tracker.log', ENTRY);
    t.as('usr_004');
    await t.api.call('tracker.delete', { id: row.entry.id });
  });
});

describe('the Balady tick of a move back asks tracker.log', () => {
  // Concept (stg_001) holds a done to-do and Schematic Design (stg_002) holds an open one, so reopening the first moves the project back.
  function backWorld(roles?: RoleSettings) {
    const t = world(roles);
    t.store.state.tasks.tsk_001 = makeTask({ id: 'tsk_001', stageId: 'stg_001', status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00', ownerId: 'usr_003' });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', stageId: 'stg_002', ownerId: 'usr_003' });
    t.store.state.counters.tsk = 2;
    return t;
  }

  it('logs the Balady line with the switch on', async () => {
    const t = backWorld();
    t.as('usr_002');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked', logInTracker: true });
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toHaveLength(1);
  });

  it('refuses the tick without the switch, and tells the screen with canLog', async () => {
    const t = backWorld(off('tracker.log.team'));
    t.as('usr_002');
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' })).rejects.toMatchObject({ details: { reason: 'stage_back_reason', canLog: false } });
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked', logInTracker: true })).rejects.toMatchObject({ code: 'forbidden' });
    // Without the tick, the same person moves the project back.
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked' });
  });
});
