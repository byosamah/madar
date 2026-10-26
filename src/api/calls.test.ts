import { describe, expect, it } from 'vitest';
import { calls, mapCalls } from './calls';
import { createApi } from './client';
import { memoryPersister } from './persist';
import { SERVER_EXCLUDED, sharedCalls } from './sharedCalls';
import { Store } from './store';
import { NOW, makeWorld, testApi } from '../test/factories';
import { setNow } from '../lib/dates';

// Spec section 11.3.
const SPEC_CALLS = [
  'session.get', 'session.previewAs',
  'users.list', 'users.get', 'users.create', 'users.update', 'users.deactivate',
  'clients.list', 'clients.create', 'clients.update',
  'projects.list', 'projects.get', 'projects.create', 'projects.update', 'projects.setLeader',
  'projects.setStatus', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'projects.delete',
  'members.add', 'members.remove', 'members.update',
  'stages.replace', 'stages.setDates', 'stages.setPrerequisites',
  'deadlines.create', 'deadlines.update', 'deadlines.delete',
  'tasks.list', 'tasks.get', 'tasks.create', 'tasks.update', 'tasks.complete', 'tasks.move', 'tasks.approve', 'tasks.sendBack', 'tasks.delete',
  'updates.list', 'updates.create', 'updates.update', 'updates.delete',
  'comments.list', 'comments.create', 'comments.update', 'comments.delete', 'reactions.toggle',
  'files.list', 'files.get', 'files.upload', 'files.delete',
  'notifications.list', 'notifications.markRead', 'notifications.markAllRead', 'notifications.updateSettings',
  'events.list', 'events.undo',
  'dashboard.get', 'search.query',
  'settings.get', 'settings.update', 'me.updatePreferences',
];
// Plan clarification 3.
// Owner's requests after the redesign (2026-10-01).
const OWNER_CALLS = ['projects.pause', 'projects.setRestart', 'projects.resume', 'projects.addLink', 'projects.updateLink', 'projects.removeLink', 'projects.setAccess'];
// Saved stage lists (owner request, 2026-10-01).
const TEMPLATE_CALLS = ['stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete'];
// Saved tasks, task versions and helpers (colleague comments 8, 9 and 12).
const TASK_CALLS = ['taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete', 'tasks.createFromTemplate', 'tasks.newVersion'];
const EXTRA_CALLS = ['session.setSimulateErrors', 'session.resetSampleData', 'me.updateProfile', 'notifications.count', 'events.undoStory', 'deadlines.list'];
// The chat (owner decision, 2026-10-01).
const CHAT_CALLS = [
  'chats.list', 'chats.messages', 'chats.send', 'chats.markRead', 'chats.markUnread', 'chats.openDirect', 'chats.unreadCount', 'chats.archive',
  // The Notify me choice of one person for one chat (chat design item 21).
  'chats.setNotify',
  // Group chats (fbk_011, plan 2026-10-18): a group is made, renamed and left in the screens.
  'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup',
  // What waits for the reply of the person (fbk_011, owner 2026-10-18): a read.
  'chats.waiting',
  // The author edits and deletes a chat message (chat design 2026-10-19, item 11).
  'chats.editMessage', 'chats.deleteMessage',
];
// Share an existing file into a chat or a task conversation (owner request, 2026-10-01).
const SHARE_CALLS = ['files.share'];
// The client tracker (owner request, 2026-10-01). A file marked as delivered logs a tracker entry.
// The folders of the Files & Links tab and the move of a file (fbk_066, owner 2026-10-26).
const FOLDER_CALLS = ['folders.create', 'folders.rename', 'folders.delete', 'files.move'];
const TRACKER_CALLS = ['tracker.list', 'tracker.log', 'tracker.close', 'tracker.update', 'tracker.delete', 'tracker.assignReply', 'tracker.export', 'files.markDelivered'];
// Payment milestones (colleague comment 6, owner, 2026-10-01).
const PAYMENT_CALLS = ['payments.list', 'payments.create', 'payments.update', 'payments.markReceived', 'payments.delete'];
// Feature requests and bug reports from the person menu (owner, 2026-10-01).
const FEEDBACK_CALLS = ['feedback.send', 'feedback.list', 'feedback.screenshot', 'feedback.setStatus'];
// Office teams (colleague comment 15). Adding a whole team to a project is a member call.
const TEAM_CALLS = ['teams.list', 'teams.create', 'teams.update', 'teams.delete', 'members.addTeam'];
const SUB_COMPANY_CALLS = ['subCompanies.list', 'subCompanies.save', 'subCompanies.delete'];
// Fixes from the audit of 2026-10-03: the Undo of "Mark all read" (SHL-16), and a way back for a deactivated person (SHL-7). And a way
// out of the lists for a turned-off person who will not come back (owner, 2026-10-12).
const AUDIT_CALLS = ['notifications.markUnread', 'users.reactivate', 'users.remove'];
// A team member takes a task with no lead (owner, 2026-10-05), and joins a task as a helper or leaves it (fbk_035).
const LEAD_CALLS = ['tasks.take', 'tasks.help'];
// The shared order of tasks inside a date group of the Tasks screen and Home (owner, 2026-10-07).
const ORDER_CALLS = ['tasks.arrange'];
// Project templates: stages, tasks, roles and dates (owner, 2026-10-05, item 6a). The Admin links an older project by names (fbk_008 item 4).
const PROJECT_TEMPLATE_CALLS = ['projectTemplates.list', 'projectTemplates.save', 'projectTemplates.delete', 'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply'];
// Browser push devices (owner, 2026-10-08).
const PUSH_CALLS = ['push.register', 'push.remove', 'push.mine'];
// Office roles and their rights (owner, 2026-10-18, fbk_014): only the Admin makes or changes a role.
const ROLE_CALLS = ['roles.create', 'roles.update', 'roles.delete'];
// The office report data (owner, 2026-10-18, fbk_016): one read call.
const REPORT_CALLS = ['reports.office'];
// The 18 server calls of the real build, with fake versions for the prototype (plan 4.11;
// live.ticket from the exit, wave 3; the four google calls of fbk_022; chats.typing of the chat presence design; the four daftra calls of the Daftra link, owner 2026-10-26).
const SERVER_CALLS = ['story.start', 'files.uploadStart', 'files.link', 'feedback.uploadStart', 'users.invites', 'users.resendInvite', 'agents.list', 'agents.remove', 'live.ticket', 'google.status', 'google.connectStart', 'google.connect', 'google.disconnect', 'chats.typing', 'daftra.status', 'daftra.paymentLink', 'daftra.findClients', 'daftra.matchClient'];
// The Daftra link (owner, 2026-10-26): a person links a payment to a Daftra invoice or takes the link away. Both are shared writes.
const DAFTRA_PAYMENT_CALLS = ['payments.linkInvoice', 'payments.unlinkInvoice'];
// Meetings, client meetings and site visits (fbk_022, owner 2026-10-19).
const MEETING_CALLS = ['meetings.list', 'meetings.get', 'meetings.create', 'meetings.update', 'meetings.cancel', 'meetings.delete', 'meetings.settle', 'meetings.extend', 'meetings.saveMinutes'];
const MAP_CALLS = [...SPEC_CALLS, ...EXTRA_CALLS, ...OWNER_CALLS, ...TEMPLATE_CALLS, ...TASK_CALLS, ...CHAT_CALLS, ...SHARE_CALLS, ...TRACKER_CALLS, ...PAYMENT_CALLS, ...FEEDBACK_CALLS, ...TEAM_CALLS, ...SUB_COMPANY_CALLS, ...AUDIT_CALLS, ...LEAD_CALLS, ...ORDER_CALLS, ...PROJECT_TEMPLATE_CALLS, ...PUSH_CALLS, ...ROLE_CALLS, ...REPORT_CALLS, ...MEETING_CALLS, ...FOLDER_CALLS, ...DAFTRA_PAYMENT_CALLS];
const CHAT_READS =new Set(['chats.list', 'chats.messages', 'chats.unreadCount', 'chats.waiting', 'push.mine']);
// Server reads named one by one, so the name rule does not decide them by accident.
const SERVER_READS = new Set(['files.link', 'users.invites', 'agents.list', 'live.ticket', 'google.status', 'google.connectStart', 'chats.typing', 'daftra.status', 'daftra.paymentLink', 'daftra.findClients']);

describe('the call map', () => {
  it('has every call from the spec plus the documented extras, and the 18 server calls', () => {
    expect(Object.keys(mapCalls).sort()).toEqual([...MAP_CALLS].sort());
    expect(Object.keys(calls).sort()).toEqual([...MAP_CALLS, ...SERVER_CALLS].sort());
    expect(Object.keys(calls)).toHaveLength(178);
  });

  it('marks exactly the read calls as read-only', () => {
    for (const [name, def] of Object.entries(calls)) {
      const read = SERVER_CALLS.includes(name)
        ? SERVER_READS.has(name)
        : /\.(list|get|count|query)$/.test(name) || CHAT_READS.has(name) || name === 'tracker.export' || name === 'feedback.screenshot'
          || name === 'projectTemplates.matchPlan' || name === 'projectTemplates.usage' || name === 'projectTemplates.syncPlan'
          || name === 'reports.office';
      expect({ name, readOnly: Boolean((def as { readOnly?: boolean }).readOnly) }).toEqual({ name, readOnly: read });
    }
  });

  it('runs a full review story through one API', async () => {
    setNow(NOW);
    const t = testApi(calls);
    t.as('usr_002');
    const project = await t.api.call('projects.create', { name: 'Harbour Offices', teamIds: ['usr_003'] });
    const task = await t.api.call('tasks.create', { projectId: project.project.id, title: 'Massing options', ownerId: 'usr_003', dueDate: '2026-10-05' });
    t.as('usr_003');
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 2, badge: 1 });
    expect((await t.api.call('tasks.complete', { id: task.task.id })).result).toBe('in_review');
    t.as('usr_002');
    expect((await t.api.call('tasks.list', { filter: 'review_for_me' })).map((r) => r.task.id)).toEqual([task.task.id]);
    await t.api.call('tasks.approve', { id: task.task.id });
    const feed = await t.api.call('updates.list', { projectId: project.project.id, filter: 'tasks' });
    expect(feed[0]).toMatchObject({ kind: 'event', verb: 'task.approved' });
    expect((await t.api.call('dashboard.get', {})).charts.throughput[11].done).toBe(1);
  });

  it('marks exactly the session calls as prototype-only, so the agent contract leaves them out', () => {
    const marked = Object.entries(calls).filter(([, def]) => (def as { prototypeOnly?: boolean }).prototypeOnly).map(([name]) => name).sort();
    expect(marked).toEqual(Object.keys(calls).filter((name) => name.startsWith('session.')).sort());
  });

  it('has 160 calls in the map', () => {
    expect(MAP_CALLS).toHaveLength(160);
    expect(Object.keys(mapCalls)).toHaveLength(160);
  });
});

describe('the calls the server runs', () => {
  it('are the 156 calls of the map without the prototype controls and the blob read', () => {
    expect([...SERVER_EXCLUDED].sort()).toEqual(['files.get', 'session.previewAs', 'session.resetSampleData', 'session.setSimulateErrors']);
    const names = Object.keys(sharedCalls);
    expect(names).toHaveLength(156);
    for (const name of SERVER_EXCLUDED) expect(names).not.toContain(name);
    for (const name of names) expect(Object.keys(mapCalls)).toContain(name);
    for (const name of SERVER_CALLS) expect(names).not.toContain(name);
    expect(sharedCalls['session.get']).toBe(calls['session.get']);
  });

  it('keep session.get as a prototype control, so it answers even when errors are simulated', async () => {
    expect(calls['session.get'].prototypeOnly).toBe(true);
    const api = createApi(calls, { store: new Store(makeWorld(), memoryPersister()), latencyMs: 0, failureRate: () => 1 });
    await expect(api.call('session.get', {})).resolves.toMatchObject({ user: { id: 'usr_001' } });
    await expect(api.call('users.list', {})).rejects.toMatchObject({ code: 'failed' });
  });
});
