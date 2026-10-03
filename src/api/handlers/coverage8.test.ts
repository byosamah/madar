import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

// The 8 calls that no API test called before (TM 2.2; plan 4.13, A6).
// Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Omar (usr_004) is outside.

describe('the calls that had no API test (plan 4.13, A6)', () => {
  it('updates.delete: the author deletes a post, another person may not, and Undo brings it back', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Site visit done.' });
    t.as('usr_002');
    await expect(t.api.call('updates.delete', { id: post.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    expect(await t.api.call('updates.delete', { id: post.id }, { correlationId: 'cor_del' })).toEqual({ deleted: true });
    expect(t.store.state.updates[post.id]).toBeUndefined();
    await expect(t.api.call('updates.delete', { id: post.id })).rejects.toMatchObject({ code: 'not_found' });
    await t.api.call('events.undoStory', { correlationId: 'cor_del' });
    expect(t.store.state.updates[post.id]?.body).toBe('Site visit done.');
  });

  it('projects.clearHealthOverride: the leader clears the health set by hand, and a team member may not', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client is slow' });
    expect(t.store.state.projects.prj_001.healthOverride?.value).toBe('at_risk');
    t.as('usr_003');
    await expect(t.api.call('projects.clearHealthOverride', { id: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const detail = await t.api.call('projects.clearHealthOverride', { id: 'prj_001' });
    expect(t.store.state.projects.prj_001.healthOverride).toBeNull();
    expect(detail.healthSetBy).toBeNull();
    expect(Object.values(t.store.state.events).at(-1)).toMatchObject({ verb: 'project.health_cleared', before: { healthOverride: { value: 'at_risk' } }, after: { healthOverride: null } });
  });

  it('members.update: the leader changes the discipline of a member, and a team member may not', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await expect(t.api.call('members.update', { projectId: 'prj_001', userId: 'usr_003', discipline: 'Interiors' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const detail = await t.api.call('members.update', { projectId: 'prj_001', userId: 'usr_003', discipline: 'Interiors' });
    expect(detail.members.find((m) => m.user.id === 'usr_003')?.discipline).toBe('Interiors');
    await expect(t.api.call('members.update', { projectId: 'prj_001', userId: 'usr_004', discipline: 'Interiors' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deadlines.update: the leader moves a deadline and ties it to a stage of the project only', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const created = await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Permit submission', date: '2026-11-15' });
    const id = created.deadlines[0].id;
    const moved = await t.api.call('deadlines.update', { id, patch: { date: '2026-11-20', stageId: 'stg_002' } });
    expect(moved.deadlines[0]).toMatchObject({ id, name: 'Permit submission', date: '2026-11-20', stageId: 'stg_002' });
    await expect(t.api.call('deadlines.update', { id, patch: { stageId: 'stg_999' } })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_003');
    await expect(t.api.call('deadlines.update', { id, patch: { name: 'Other' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('deadlines.delete: the leader deletes a deadline, a team member may not, and Undo brings it back', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const id = (await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Permit submission', date: '2026-11-15' })).deadlines[0].id;
    t.as('usr_003');
    await expect(t.api.call('deadlines.delete', { id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    expect((await t.api.call('deadlines.delete', { id }, { correlationId: 'cor_ddl' })).deadlines).toEqual([]);
    await t.api.call('events.undoStory', { correlationId: 'cor_ddl' });
    expect(t.store.state.deadlines[id]?.name).toBe('Permit submission');
  });

  it('users.list: lists active people by name, and inactive people only on request', async () => {
    const t = testApi(calls);
    t.store.state.users.usr_004.active = false;
    t.as('usr_003');
    const active = await t.api.call('users.list', {});
    expect(active.map((u) => u.id)).not.toContain('usr_004');
    expect(active.map((u) => u.name)).toEqual([...active.map((u) => u.name)].sort((a, b) => a.localeCompare(b)));
    expect((await t.api.call('users.list', { includeInactive: true })).map((u) => u.id)).toContain('usr_004');
  });

  it('users.get: returns one person, and not_found for an unknown id', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    expect(await t.api.call('users.get', { id: 'usr_002' })).toMatchObject({ id: 'usr_002', name: 'Faisal Leader', active: true });
    await expect(t.api.call('users.get', { id: 'usr_999' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('clients.list: lists the clients by their English name, or by the Arabic name when that is the only one', async () => {
    const t = testApi(calls);
    const client = { contactName: '', phone: '', email: '' };
    t.store.state.clients.cli_001 = { ...client, id: 'cli_001', name: 'Zahran Group' };
    t.store.state.clients.cli_002 = { ...client, id: 'cli_002', name: '', nameAr: 'Basma' };
    t.store.state.clients.cli_003 = { ...client, id: 'cli_003', name: 'Al Noor' };
    t.as('usr_003');
    expect((await t.api.call('clients.list', {})).map((c) => c.id)).toEqual(['cli_003', 'cli_002', 'cli_001']);
  });
});
