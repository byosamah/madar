import { beforeEach, describe, expect, it } from 'vitest';
import { fileCalls } from './files';
import { shareCalls } from './sharing';
import { taskCalls } from './tasks';
import type { RoleSettings } from '../contract/entities';
import { makeTask, NOW, testApi } from '../../test/factories';
import { both, without as off, withExtra as extra } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The file gates of role rights version 2 (design 5.5): file.upload, file.deliver, file.share, file.deleteOwn, file.deleteAny.
 * People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member, usr_004 outside the team, usr_005 agent of usr_003.
 */
const calls = { ...fileCalls, ...shareCalls, ...taskCalls };
const pdf = (text = 'x') => new Blob([text], { type: 'application/pdf' });
const png = () => new Blob(['x'], { type: 'image/png' });

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', createdBy: 'usr_002' });
  t.store.state.counters.tsk = 1;
  if (roles) t.store.state.settings.roles = roles;
  return t;
}

describe('file.upload: a file of a project or a to-do', () => {
  it('passes for the team with the switch on, and refuses with it off', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    const closed = world(off('file.upload.team'));
    closed.as('usr_003');
    await expect(closed.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() })).rejects.toMatchObject({ code: 'forbidden' });
    closed.as('usr_002');
    await expect(closed.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps a person outside the team out, and lets the all switch open it', async () => {
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() })).rejects.toMatchObject({ code: 'forbidden' });
    const all = world(extra('file.upload.all'));
    all.as('usr_004');
    await all.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
  });

  it('refuses the agent of a person without the switch', async () => {
    const closed = world(off('file.upload.team'));
    closed.as('usr_005');
    await expect(closed.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('asks the same switch for a file of an office to-do', async () => {
    const t = world();
    t.as('usr_003');
    const office = (await t.api.call('tasks.create', { title: 'Office', ownerId: 'usr_003' })).task;
    await t.api.call('files.upload', { taskId: office.id, name: 'a.pdf', blob: pdf() });
    t.store.state.settings.roles = off('file.upload.team');
    await expect(t.api.call('files.upload', { taskId: office.id, name: 'b.pdf', blob: pdf() })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps the other switches apart: the delivery stays open when only the upload is off', async () => {
    const t = world();
    t.as('usr_002');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.store.state.settings.roles = off('file.upload.team');
    t.as('usr_003');
    const delivered = await t.api.call('files.markDelivered', { id: file.file.id });
    expect(delivered.entry.auto).toBe('delivered');
  });
});

describe('file.deliver: Received from the client and Mark as delivered', () => {
  it('lets the upload log a client file with the switch on, and refuses it with the switch off', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf(), receivedFromClient: true });
    const closed = world(off('file.deliver.team'));
    closed.as('usr_003');
    await expect(closed.api.call('files.upload', { projectId: 'prj_001', name: 'b.pdf', blob: pdf(), receivedFromClient: true })).rejects.toMatchObject({ code: 'forbidden' });
    // The same upload without the client tick is not a delivery, so the upload switch alone passes.
    await closed.api.call('files.upload', { projectId: 'prj_001', name: 'b.pdf', blob: pdf() });
  });

  it('refuses Mark as delivered with the switch off, for the person and for the agent', async () => {
    const t = world();
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.store.state.settings.roles = off('file.deliver.team');
    await expect(t.api.call('files.markDelivered', { id: file.file.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('files.markDelivered', { id: file.file.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps a person outside the team out', async () => {
    const t = world();
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.as('usr_004');
    await expect(t.api.call('files.markDelivered', { id: file.file.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the cover of a project asks project.details', () => {
  it('passes for the leader and refuses when the details switch of the leader is off', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'cover.png', blob: png(), asCover: true });
    const closed = world(off('project.details.lead'));
    closed.as('usr_002');
    await expect(closed.api.call('files.upload', { projectId: 'prj_001', name: 'cover.png', blob: png(), asCover: true })).rejects.toMatchObject({ code: 'forbidden' });
    // The same person still uploads a plain file.
    await closed.api.call('files.upload', { projectId: 'prj_001', name: 'plain.png', blob: png() });
  });

  it('refuses a team member who is not the leader', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'cover.png', blob: png(), asCover: true })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('file.deleteOwn and file.deleteAny: the delete of a file', () => {
  async function uploaded(roles?: RoleSettings) {
    const t = world();
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    if (roles) t.store.state.settings.roles = roles;
    return { t, id: file.file.id };
  }

  it('lets the uploader delete with the switch on, and refuses with it off', async () => {
    const on = await uploaded();
    await on.t.api.call('files.delete', { id: on.id });
    const closed = await uploaded(off('file.deleteOwn'));
    await expect(closed.t.api.call('files.delete', { id: closed.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await closed.t.api.call('files.list', { projectId: 'prj_001' }))[0].canDelete).toBe(false);
  });

  it('refuses another team member, and the agent of an uploader without the switch', async () => {
    const t = world();
    t.as('usr_002');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.as('usr_003');
    await expect(t.api.call('files.delete', { id: file.file.id })).rejects.toMatchObject({ code: 'forbidden' });
    const closed = await uploaded(off('file.deleteOwn'));
    closed.t.as('usr_005');
    await expect(closed.t.api.call('files.delete', { id: closed.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader delete any file of the project with the lead switch, and refuses with it off', async () => {
    const on = await uploaded();
    on.t.as('usr_002');
    await on.t.api.call('files.delete', { id: on.id });
    const closed = await uploaded(off('file.deleteAny.lead'));
    closed.t.as('usr_002');
    await expect(closed.t.api.call('files.delete', { id: closed.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets a holder of the all switch delete the file of a project, and nobody else outside the team', async () => {
    const t = world(both([], ['file.deleteAny.all']));
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.as('usr_004');
    await t.api.call('files.delete', { id: file.file.id });
    const plain = world();
    plain.as('usr_003');
    const other = await plain.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    plain.as('usr_004');
    await expect(plain.api.call('files.delete', { id: other.file.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('file.share: share a file into a to-do', () => {
  it('passes with the switch on and refuses with it off, for the person and the agent', async () => {
    const t = world();
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    await t.api.call('files.share', { fileId: file.file.id, target: { kind: 'task', taskId: 'tsk_001' } });
    t.store.state.settings.roles = off('file.share');
    await expect(t.api.call('files.share', { fileId: file.file.id, target: { kind: 'task', taskId: 'tsk_001' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('files.share', { fileId: file.file.id, target: { kind: 'task', taskId: 'tsk_001' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps the comment switch: a share into a to-do is a comment', async () => {
    const t = world();
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.store.state.settings.roles = off('comment.create.team');
    await expect(t.api.call('files.share', { fileId: file.file.id, target: { kind: 'task', taskId: 'tsk_001' } })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
