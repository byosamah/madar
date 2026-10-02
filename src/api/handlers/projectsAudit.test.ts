import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { memberKey } from '../store';

beforeEach(() => setNow(NOW));

// Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Hala (usr_001) is the Admin.

describe('A paused project that leaves the pause closes it (audit 2026-10-03, API-8, PRJ-17)', () => {
  const openLoops = (t: ReturnType<typeof testApi>) => t.api.call('tracker.list', { projectId: 'prj_001', openOnly: true });

  it('closes the pause and its client item when the project is completed', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Waiting for the soil report', kind: 'client' });
    await t.api.call('projects.setStatus', { id: 'prj_001', status: 'completed' });
    expect(t.store.state.projects.prj_001.pause ?? null).toBeNull();
    expect(await openLoops(t)).toEqual([]);
    await t.api.call('projects.setStatus', { id: 'prj_001', status: 'active' });
    expect(t.store.state.projects.prj_001.pause ?? null).toBeNull();
  });

  it('closes them when the project is archived, and one Undo brings both back', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Waiting for the soil report', kind: 'client' });
    await t.api.call('projects.setStatus', { id: 'prj_001', status: 'archived' }, { correlationId: 'cor_arc' });
    expect(await openLoops(t)).toEqual([]);
    await t.api.call('events.undoStory', { correlationId: 'cor_arc' });
    expect(t.store.state.projects.prj_001.status).toBe('on_hold');
    expect(t.store.state.projects.prj_001.pause?.reason).toBe('Waiting for the soil report');
    expect(await openLoops(t)).toHaveLength(1);
  });

  it('refuses a pause with no reason through projects.setStatus', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await expect(t.api.call('projects.setStatus', { id: 'prj_001', status: 'on_hold' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'pause_needs_reason' } });
    expect(t.store.state.projects.prj_001.status).toBe('active');
  });
});

describe('Deleting a project removes its Tracker entries and its file data (audit 2026-10-03, API-17)', () => {
  it('leaves no Tracker entry and no stored file data of the project', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('tracker.log', { projectId: 'prj_001', type: 'meeting', direction: 'both', title: 'Kickoff' });
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: new Blob(['a'], { type: 'application/pdf' }) });
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: new Blob(['b'], { type: 'application/pdf' }) });
    const keys = t.store.state.files[file.file.id].versions.map((version) => version.blobKey);
    expect(await t.store.persister.getBlob(keys[0])).not.toBeNull();
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(Object.keys(t.store.state.tracker ?? {})).toHaveLength(0);
    for (const key of keys) expect(await t.store.persister.getBlob(key)).toBeNull();
  });
});

describe('The Team tab counts the tasks a person leads or helps on (audit 2026-10-03, PRJ-3)', () => {
  it('counts a helper task, and names the rule when Remove is refused', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.users.usr_006 = { ...s.users.usr_003, id: 'usr_006', name: 'Lina Helper', email: 'lina@madar.test' };
    s.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Stair details', helperIds: ['usr_006'] });
    t.as('usr_002');
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.members.find((m) => m.user.id === 'usr_006')?.openTasks).toBe(1);
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_006' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'member_has_open_tasks' },
    });
  });
});
