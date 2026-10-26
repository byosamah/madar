import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../lib/dates';
import { makeTask, makeUser, NOW, testApi } from '../test/factories';
import type { RoleSettings } from './contract/entities';
import { type Action, can } from './permissions';
import { rightsOf, withOfficeRights } from './rights';
import { paymentCalls } from './handlers/payments';
import { historyCalls } from './handlers/history';
import { peopleCalls } from './handlers/people';
import { projectCalls } from './handlers/projects';
import { taskCalls } from './handlers/tasks';
import { rolesCalls } from './handlers/roles';
import { contentCalls } from './handlers/content';
import { BASIC_ON } from './rightsCatalog';

beforeEach(() => setNow(NOW));

const calls = { ...paymentCalls, ...historyCalls, ...peopleCalls, ...projectCalls, ...taskCalls, ...rolesCalls, ...contentCalls };

/**
 * The flags of viewerCan (design section 7) and the Undo rules (section 6.5). usr_001 is the Admin, usr_002 leads prj_001, usr_003 is on
 * its team, usr_004 is outside. usr_005 is the agent of usr_003. usr_006 is Accounting.
 */
function world(roles?: RoleSettings) {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Noura Accounting', systemRole: 'accounting' });
  state.counters.usr = 6;
  if (roles) state.settings.roles = roles;
  t.as('usr_001');
  return t;
}

const PROJECT_FLAGS = [
  'editDetails', 'editTeam', 'editStages', 'editDeadlines', 'applyTemplate', 'links', 'upload', 'deliver', 'logTracker', 'postUpdate',
  'comment', 'addTask', 'planMeeting', 'deleteAnyFile', 'deleteAnyTracker', 'projectChat', 'changeAnyTask',
] as const;

describe('viewerCan of a project: one flag for each new gate', () => {
  it('gives the leader every flag, the team the flags of the team switches, and the outsider none', async () => {
    const t = world();
    t.as('usr_002');
    const leader = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    for (const flag of PROJECT_FLAGS) expect(leader[flag], `leader ${flag}`).toBe(true);
    t.as('usr_003');
    const team = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    for (const flag of ['links', 'upload', 'deliver', 'logTracker', 'postUpdate', 'comment', 'addTask', 'planMeeting', 'projectChat'] as const) {
      expect(team[flag], `team ${flag}`).toBe(true);
    }
    for (const flag of ['editDetails', 'editTeam', 'editStages', 'editDeadlines', 'applyTemplate', 'deleteAnyFile', 'deleteAnyTracker', 'changeAnyTask'] as const) {
      expect(team[flag], `team ${flag}`).toBe(false);
    }
    t.as('usr_004');
    const outsider = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    for (const flag of PROJECT_FLAGS) expect(outsider[flag], `outsider ${flag}`).toBe(false);
    t.as('usr_001');
    const admin = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    for (const flag of PROJECT_FLAGS) expect(admin[flag], `admin ${flag}`).toBe(true);
  });

  it('keeps every old flag next to the new ones', async () => {
    const t = world();
    t.as('usr_002');
    const flags = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    for (const old of ['edit', 'changeLeader', 'archive', 'delete', 'healthOverride', 'createTaskForAnyone', 'createTaskForSelf', 'post', 'review', 'payments']) {
      expect(flags, old).toHaveProperty(old);
    }
    expect(flags.delete).toBe(false);
  });

  it('turns a flag off when the office turns the switch off, and keeps the others', async () => {
    const t = world({ off: { member: ['post.create.team', 'file.upload.team', 'tracker.log.team'] } });
    t.as('usr_003');
    const team = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    expect(team.postUpdate).toBe(false);
    expect(team.upload).toBe(false);
    expect(team.logTracker).toBe(false);
    expect(team.comment).toBe(true);
    expect(team.links).toBe(true);
    t.as('usr_002');
    // The leader is a Member too: the team switch reaches the leader, as the leader counts as on the team.
    const leader = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    expect(leader.postUpdate).toBe(false);
    expect(leader.editDetails).toBe(true);
  });

  it('opens the details flag of a project the person does not lead with the all switch', async () => {
    const t = world({ rights: { member: ['project.details.all', 'project.stages.all'] } });
    t.as('usr_004');
    const outsider = (await t.api.call('projects.get', { id: 'prj_001' })).viewerCan;
    expect(outsider.editDetails).toBe(true);
    expect(outsider.editStages).toBe(true);
    expect(outsider.editTeam).toBe(false);
    expect(outsider.postUpdate).toBe(false);
  });

  it('gives the payments flag to the people with the view switch, and to nobody else', async () => {
    const t = world();
    t.as('usr_006');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(true);
    t.as('usr_003');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(false);
    t.store.state.settings.roles = { rights: { accounting: ['payment.view', 'payment.add'] } };
    t.as('usr_006');
    // payment.add needs payment.view: the sheet sends both, and a stored list without the view switch counts payment.add as off.
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(true);
    t.store.state.settings.roles = { rights: { accounting: [] } };
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(false);
  });
});

describe('viewerCan of a to-do: one flag for each gate of the panel', () => {
  async function taskOf(t: ReturnType<typeof world>, ownerId: string) {
    t.store.state.tasks.tsk_900 = makeTask({ id: 'tsk_900', projectId: 'prj_001', stageId: 'stg_001', ownerId, createdBy: ownerId });
    return t.api.call('tasks.get', { id: 'tsk_900' });
  }

  it('gives the lead the flags of the lead, with the default switches', async () => {
    const t = world();
    t.as('usr_003');
    const { viewerCan } = await taskOf(t, 'usr_003');
    for (const flag of ['editDetails', 'editDates', 'work', 'comment', 'upload'] as const) expect(viewerCan[flag], flag).toBe(true);
  });

  it('turns the date flag off with the date switch, and leaves the detail flag on', async () => {
    const t = world({ off: { member: ['task.dates'] } });
    t.as('usr_003');
    const { viewerCan } = await taskOf(t, 'usr_003');
    expect(viewerCan.editDates).toBe(false);
    expect(viewerCan.editDetails).toBe(true);
    expect(viewerCan.work).toBe(true);
    // The leader changes any to-do of the project (task.any.lead), so the leader keeps the dates.
    t.as('usr_002');
    expect((await t.api.call('tasks.get', { id: 'tsk_900' })).viewerCan.editDates).toBe(true);
  });

  it('gives a team member who neither leads nor made the to-do no flag of change', async () => {
    const t = world();
    t.as('usr_003');
    t.store.state.tasks.tsk_901 = makeTask({ id: 'tsk_901', projectId: 'prj_001', stageId: 'stg_001', ownerId: 'usr_002', createdBy: 'usr_002' });
    const { viewerCan } = await t.api.call('tasks.get', { id: 'tsk_901' });
    for (const flag of ['editDetails', 'editDates', 'work'] as const) expect(viewerCan[flag], flag).toBe(false);
    expect(viewerCan.comment).toBe(true);
  });
});

describe('the Undo asks the right of its own act', () => {
  it('lets the maker take back a new to-do with the add switch, and not without it (the delete switch does not matter)', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'A new to-do', stageId: 'stg_001' });
    const created = Object.values(t.store.state.events).find((event) => event.verb === 'task.created' && event.targetId === made.task.id)!;
    // The delete switch is off, the add switch is on: the Undo of the making passes.
    t.store.state.settings.roles = { off: { member: ['task.deleteOwn'] } };
    await expect(t.api.call('events.undo', { eventId: created.id })).resolves.toBeDefined();
    const second = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Another to-do', stageId: 'stg_001' });
    const secondEvent = Object.values(t.store.state.events).find((event) => event.verb === 'task.created' && event.targetId === second.task.id)!;
    // The add switch is off: the Undo of the making is refused.
    t.store.state.settings.roles = { off: { member: ['task.add.team'] } };
    await expect(t.api.call('events.undo', { eventId: secondEvent.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('asks the payment switch of the change: add for a new payment, change for an edit', async () => {
    const t = world();
    t.as('usr_006');
    const made = await t.api.call('payments.create', { projectId: 'prj_001', name: 'Fee', amount: 1000, dueDate: '2026-10-10' });
    const created = Object.values(t.store.state.events).find((event) => event.verb === 'payment.created' && event.targetId === made.payment.id)!;
    t.store.state.settings.roles = { rights: { accounting: ['payment.view', 'payment.change', 'payment.receive'] } };
    // payment.add is off: the Undo of the making is refused.
    await expect(t.api.call('events.undo', { eventId: created.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.store.state.settings.roles = { rights: { accounting: ['payment.view', 'payment.add'] } };
    await expect(t.api.call('events.undo', { eventId: created.id })).resolves.toBeDefined();
  });

  it('keeps the Undo of a role change with the Admin, and asks the settings switch for a settings change', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'member', off: ['chat.direct'] });
    await t.api.call('settings.update', { workloadLimit: 9 });
    const roleEvent = Object.values(t.store.state.events).find((event) => event.verb === 'role.updated')!;
    const settingsEvent = Object.values(t.store.state.events).find((event) => event.verb === 'settings.updated')!;
    // Make the settings change the change of a Member, so the Member may take it back when the office gives the settings switch.
    settingsEvent.actingForId = 'usr_003';
    settingsEvent.actorId = 'usr_003';
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: settingsEvent.id })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'office.settings' } });
    t.store.state.settings.roles = { ...t.store.state.settings.roles, rights: { member: ['office.settings'] } };
    // The right passes. The store has no Undo for a settings event (conflict), which is after the right check.
    await expect(t.api.call('events.undo', { eventId: settingsEvent.id })).rejects.toMatchObject({ code: 'conflict' });
    // A role event keeps the Admin only: the settings switch does not open it.
    // The store keeps a new copy of its state after a call, so the event is read again.
    t.store.state.events[roleEvent.id].actingForId = 'usr_003';
    await expect(t.api.call('events.undo', { eventId: roleEvent.id })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'admin.manage' } });
  });
});

describe('an agent of a person without a switch is refused', () => {
  it('refuses tasks.take to the agent of a Member whose take switch is off, and lets the person with the switch take', async () => {
    const t = world({ off: { member: ['task.take'] } });
    t.store.state.tasks.tsk_902 = makeTask({ id: 'tsk_902', projectId: 'prj_001', stageId: 'stg_001', ownerId: null, createdBy: 'usr_002' });
    t.as('usr_005');
    await expect(t.api.call('tasks.take', { taskId: 'tsk_902' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await expect(t.api.call('tasks.take', { taskId: 'tsk_902' })).rejects.toMatchObject({ code: 'forbidden' });
    t.store.state.settings.roles = {};
    t.as('usr_005');
    await expect(t.api.call('tasks.take', { taskId: 'tsk_902' })).resolves.toBeDefined();
  });
});

describe('the actor of an agent carries the rights of its person', () => {
  it('gives the agent the rights of the person and not the Member rights of its own record', () => {
    const t = world({ rights: { member: [] }, custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين', rights: ['payment.view', 'report.office'] }] });
    t.store.state.users.usr_003 = { ...t.store.state.users.usr_003, roleId: 'rol_001' };
    const person = withOfficeRights(t.store.state.users.usr_003, t.store.state.settings.roles);
    expect(person.officeRights).toContain('report.office');
    const agent = t.store.state.users.usr_005;
    // The record of the agent has the Member role, so read alone it holds the Member switches only.
    expect(rightsOf(agent, t.store.state.settings.roles)).not.toContain('report.office');
    expect(can(withOfficeRights(agent, t.store.state.settings.roles), 'report.office')).toBe(false);
    expect(can(person, 'report.office')).toBe(true);
    expect(BASIC_ON.length).toBe(68);
    const asAction: Action = 'report.office';
    expect(can(person, asAction)).toBe(true);
  });
});
