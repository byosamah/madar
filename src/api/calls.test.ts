import { describe, expect, it } from 'vitest';
import { calls } from './calls';
import { NOW, testApi } from '../test/factories';
import { setNow } from '../lib/dates';

// Spec section 11.3.
const SPEC_CALLS = [
  'session.get', 'session.previewAs',
  'users.list', 'users.get', 'users.create', 'users.update', 'users.deactivate',
  'clients.list', 'clients.create', 'clients.update',
  'projects.list', 'projects.get', 'projects.create', 'projects.update', 'projects.setStage', 'projects.setLeader',
  'projects.setStatus', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'projects.delete',
  'members.add', 'members.remove', 'members.update',
  'stages.replace', 'stages.setDates',
  'deadlines.create', 'deadlines.update', 'deadlines.delete',
  'tasks.list', 'tasks.get', 'tasks.create', 'tasks.update', 'tasks.complete', 'tasks.move', 'tasks.approve', 'tasks.sendBack', 'tasks.delete',
  'updates.list', 'updates.create', 'updates.update', 'updates.delete',
  'comments.list', 'comments.create', 'comments.update', 'comments.delete', 'reactions.toggle',
  'files.list', 'files.get', 'files.upload', 'files.delete',
  'time.week', 'time.set', 'time.copyLastWeek', 'time.unlockWeek',
  'notifications.list', 'notifications.markRead', 'notifications.markAllRead', 'notifications.updateSettings',
  'events.list', 'events.undo',
  'dashboard.get', 'search.query',
  'settings.get', 'settings.update', 'me.updatePreferences',
];
// Plan clarification 3.
const EXTRA_CALLS = ['session.setSimulateErrors', 'session.resetSampleData', 'me.updateProfile', 'notifications.count', 'time.addRow', 'time.removeRow'];

describe('the call map', () => {
  it('has every call from the spec plus the documented extras', () => {
    expect(Object.keys(calls).sort()).toEqual([...SPEC_CALLS, ...EXTRA_CALLS].sort());
  });

  it('marks exactly the read calls as read-only', () => {
    for (const [name, def] of Object.entries(calls)) {
      const read = /\.(list|get|week|count|query)$/.test(name);
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
