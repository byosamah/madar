import { describe, expect, it } from 'vitest';
import { calls } from './calls';
import { NOW, testApi } from '../test/factories';
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
const OWNER_CALLS = ['projects.pause', 'projects.resume', 'projects.addLink', 'projects.updateLink', 'projects.removeLink'];
// Saved stage lists (owner request, 2026-10-01).
const TEMPLATE_CALLS = ['stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete'];
// Saved tasks, task versions and helpers (colleague comments 8, 9 and 12).
const TASK_CALLS = ['taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete', 'tasks.createFromTemplate', 'tasks.newVersion'];
const EXTRA_CALLS = ['session.setSimulateErrors', 'session.resetSampleData', 'me.updateProfile', 'notifications.count', 'events.undoStory', 'deadlines.list'];
// The chat (owner decision, 2026-10-01).
const CHAT_CALLS = ['chats.list', 'chats.messages', 'chats.send', 'chats.markRead', 'chats.openDirect', 'chats.unreadCount'];
// Share an existing file into a chat or a task conversation (owner request, 2026-10-01).
const SHARE_CALLS = ['files.share'];
// The client tracker (owner request, 2026-10-01). A file marked as delivered logs a tracker entry.
const TRACKER_CALLS = ['tracker.list', 'tracker.log', 'tracker.close', 'tracker.update', 'tracker.delete', 'tracker.assignReply', 'tracker.export', 'files.markDelivered'];
// Payment milestones (colleague comment 6, owner, 2026-10-01).
const PAYMENT_CALLS = ['payments.list', 'payments.create', 'payments.update', 'payments.markReceived', 'payments.delete'];
// Feature requests and bug reports from the person menu (owner, 2026-10-01).
const FEEDBACK_CALLS = ['feedback.send', 'feedback.list', 'feedback.screenshot', 'feedback.setStatus'];
// Office teams (colleague comment 15). Adding a whole team to a project is a member call.
const TEAM_CALLS = ['teams.list', 'teams.create', 'teams.update', 'teams.delete', 'members.addTeam'];
// Fixes from the audit of 2026-10-03: the Undo of "Mark all read" (SHL-16), and a way back for a deactivated person (SHL-7).
const AUDIT_CALLS = ['notifications.markUnread', 'users.reactivate'];
const CHAT_READS =new Set(['chats.list', 'chats.messages', 'chats.unreadCount']);

describe('the call map', () => {
  it('has every call from the spec plus the documented extras', () => {
    expect(Object.keys(calls).sort()).toEqual([...SPEC_CALLS, ...EXTRA_CALLS, ...OWNER_CALLS, ...TEMPLATE_CALLS, ...TASK_CALLS, ...CHAT_CALLS, ...SHARE_CALLS, ...TRACKER_CALLS, ...PAYMENT_CALLS, ...FEEDBACK_CALLS, ...TEAM_CALLS, ...AUDIT_CALLS].sort());
  });

  it('marks exactly the read calls as read-only', () => {
    for (const [name, def] of Object.entries(calls)) {
      const read = /\.(list|get|count|query)$/.test(name) || CHAT_READS.has(name) || name === 'tracker.export' || name === 'feedback.screenshot';
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
});
