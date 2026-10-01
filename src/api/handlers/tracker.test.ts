import { beforeEach, describe, expect, it } from 'vitest';
import { trackerCalls } from './tracker';
import { fileCalls } from './files';
import { historyCalls } from './history';
import { makeProject, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...trackerCalls, ...fileCalls, ...historyCalls };
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

// Hala is the Admin, Faisal leads prj_001, Sara is on the team, Omar is outside, usr_005 is Sara's agent. File fil_001 is in prj_001, fil_002 is in prj_002.
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'P-002', name: 'Other project', leaderId: 'usr_001' });
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
  state.files.fil_001 = { id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Survey.pdf', versions: [version] };
  state.files.fil_002 = { id: 'fil_002', projectId: 'prj_002', stageId: null, taskId: null, name: 'Secret.pdf', versions: [version] };
  return t;
}

const BASE = { projectId: 'prj_001', type: 'message', direction: 'in', title: 'Client asked about the lobby' } as const;

describe('tracker.log', () => {
  it('logs an entry with the defaults: today, no note, no loop', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', { ...BASE, title: '  Client asked about the lobby  ' });
    expect(row.entry).toMatchObject({
      id: 'trk_001', projectId: 'prj_001', type: 'message', direction: 'in', title: 'Client asked about the lobby', note: '', date: '2026-09-30',
      waiting: null, closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_003',
    });
    expect(row.createdBy.name).toBe('Sara Team');
    expect(row).toMatchObject({ canClose: false, canEdit: true, canDelete: true });
  });

  it('keeps the date, the note, the loop, the people and the files', async () => {
    const t = world();
    t.as('usr_002');
    const row = await t.api.call('tracker.log', {
      ...BASE, type: 'file', date: '2026-09-20', note: 'On a USB stick.', waiting: 'us', fileIds: ['fil_001'], peopleIds: ['usr_003'],
    });
    expect(row.entry).toMatchObject({ date: '2026-09-20', note: 'On a USB stick.', waiting: 'us', fileIds: ['fil_001'], peopleIds: ['usr_003'] });
    expect(row.files).toEqual([{ id: 'fil_001', name: 'Survey.pdf' }]);
    expect(row.people.map((p) => p.name)).toEqual(['Sara Team']);
    expect(row.canClose).toBe(true);
  });

  it('lets the leader, the team and the Admin log, and refuses an outsider', async () => {
    const t = world();
    for (const user of ['usr_001', 'usr_002', 'usr_003']) {
      t.as(user);
      await t.api.call('tracker.log', BASE);
    }
    t.as('usr_004');
    await expect(t.api.call('tracker.log', BASE)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('logs for the person an agent acts for', async () => {
    const t = world();
    t.as('usr_005');
    const row = await t.api.call('tracker.log', BASE);
    expect(row.entry.createdBy).toBe('usr_005');
    expect(row.createdBy.kind).toBe('agent');
    t.as('usr_004');
    await expect(t.api.call('tracker.log', BASE)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a blank title, a long title, a long note, a bad date and more than 10 files', async () => {
    const t = world();
    await expect(t.api.call('tracker.log', { ...BASE, title: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.log', { ...BASE, title: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.log', { ...BASE, note: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.log', { ...BASE, date: '30/09/2026' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.log', { ...BASE, fileIds: Array.from({ length: 11 }, (_, i) => `fil_${String(i + 1).padStart(3, '0')}`) })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a file of another project, a missing file and a missing person', async () => {
    const t = world();
    await expect(t.api.call('tracker.log', { ...BASE, fileIds: ['fil_002'] })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['fileIds'] } });
    await expect(t.api.call('tracker.log', { ...BASE, fileIds: ['fil_099'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.log', { ...BASE, peopleIds: ['usr_099'] })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('tracker.log', { ...BASE, projectId: 'prj_099' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('works in an old office that has no tracker collection', async () => {
    const t = world();
    delete t.store.state.tracker;
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
    await t.api.call('tracker.log', BASE);
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toHaveLength(1);
  });
});

describe('tracker.list', () => {
  async function filled() {
    const t = world();
    await t.api.call('tracker.log', { projectId: 'prj_002', type: 'message', direction: 'in', title: 'Other project' });
    t.as('usr_002');
    await t.api.call('tracker.log', { ...BASE, title: 'Old meeting', type: 'meeting', date: '2026-09-01' });
    await t.api.call('tracker.log', { ...BASE, title: 'Question', waiting: 'us', date: '2026-09-25' });
    await t.api.call('tracker.log', { ...BASE, title: 'Asked for survey', direction: 'out', waiting: 'client', date: '2026-09-26' });
    await t.api.call('tracker.log', { ...BASE, title: 'Permit news', type: 'balady', date: '2026-09-28' });
    await t.api.call('tracker.log', { ...BASE, title: 'Same day, later', date: '2026-09-28' });
    return t;
  }
  const titles = (rows: { entry: { title: string } }[]) => rows.map((r) => r.entry.title);

  it('lists one project, newest day first, and the later log first on one day', async () => {
    const t = await filled();
    expect(titles(await t.api.call('tracker.list', { projectId: 'prj_001' }))).toEqual(
      ['Same day, later', 'Permit news', 'Asked for survey', 'Question', 'Old meeting'],
    );
  });

  it('filters by type, by direction and by open loops', async () => {
    const t = await filled();
    expect(titles(await t.api.call('tracker.list', { projectId: 'prj_001', type: 'meeting' }))).toEqual(['Old meeting']);
    expect(titles(await t.api.call('tracker.list', { projectId: 'prj_001', direction: 'out' }))).toEqual(['Asked for survey']);
    expect(titles(await t.api.call('tracker.list', { projectId: 'prj_001', openOnly: true }))).toEqual(['Asked for survey', 'Question']);
    expect(titles(await t.api.call('tracker.list', { projectId: 'prj_001', type: 'message', direction: 'in', openOnly: true }))).toEqual(['Question']);
  });

  it('lets anyone who can open the project read the list', async () => {
    const t = await filled();
    t.as('usr_004');
    const rows = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => !r.canEdit && !r.canClose && !r.canDelete)).toBe(true);
  });
});

describe('tracker.close', () => {
  it('closes an open loop and records who and when', async () => {
    const t = world();
    t.as('usr_003');
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us' });
    t.as('usr_002');
    const row = await t.api.call('tracker.close', { id: entry.id });
    expect(row.entry).toMatchObject({ closedBy: 'usr_002', waiting: 'us' });
    expect(row.entry.closedAt).toBe('2026-09-30T09:00:00.000+03:00');
    expect(row.closedBy?.name).toBe('Faisal Leader');
    expect(row.canClose).toBe(false);
    expect(await t.api.call('tracker.list', { projectId: 'prj_001', openOnly: true })).toEqual([]);
  });

  it('refuses a second close and an entry that waits for nothing', async () => {
    const t = world();
    const open = await t.api.call('tracker.log', { ...BASE, waiting: 'client' });
    const plain = await t.api.call('tracker.log', BASE);
    await t.api.call('tracker.close', { id: open.entry.id });
    await expect(t.api.call('tracker.close', { id: open.entry.id })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.close', { id: plain.entry.id })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.close', { id: 'trk_099' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses an outsider', async () => {
    const t = world();
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us' });
    t.as('usr_004');
    await expect(t.api.call('tracker.close', { id: entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('undoes a close with the Undo of the story', async () => {
    const t = world();
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us' });
    await t.api.call('tracker.close', { id: entry.id }, { correlationId: 'cor_close' });
    await t.api.call('events.undoStory', { correlationId: 'cor_close' });
    expect(t.store.state.tracker?.[entry.id]).toMatchObject({ closedAt: null, closedBy: null });
  });
});

describe('tracker.update', () => {
  it('changes the fields it is given and nothing else', async () => {
    const t = world();
    t.as('usr_003');
    const { entry } = await t.api.call('tracker.log', { ...BASE, note: 'Old note' });
    const row = await t.api.call('tracker.update', { id: entry.id, title: 'New title', date: '2026-09-29', type: 'meeting', peopleIds: ['usr_002'] });
    expect(row.entry).toMatchObject({ title: 'New title', date: '2026-09-29', type: 'meeting', note: 'Old note', direction: 'in', peopleIds: ['usr_002'] });
  });

  it('opens a loop again when the waiting value changes, and ends it when the value goes', async () => {
    const t = world();
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us' });
    await t.api.call('tracker.close', { id: entry.id });
    const changed = await t.api.call('tracker.update', { id: entry.id, waiting: 'client' });
    expect(changed.entry).toMatchObject({ waiting: 'client', closedAt: null, closedBy: null });
    const ended = await t.api.call('tracker.update', { id: entry.id, waiting: null });
    expect(ended.entry.waiting).toBeNull();
  });

  it('keeps a closed loop closed when the waiting value stays the same', async () => {
    const t = world();
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us' });
    await t.api.call('tracker.close', { id: entry.id });
    const row = await t.api.call('tracker.update', { id: entry.id, waiting: 'us', title: 'Renamed' });
    expect(row.entry.closedBy).toBe('usr_001');
  });

  it('checks the files, the rights and the length', async () => {
    const t = world();
    t.as('usr_003');
    const { entry } = await t.api.call('tracker.log', BASE);
    await expect(t.api.call('tracker.update', { id: entry.id, fileIds: ['fil_002'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tracker.update', { id: entry.id, title: '' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_004');
    await expect(t.api.call('tracker.update', { id: entry.id, title: 'Hacked' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('tracker.delete', () => {
  it('lets the author, the leader and the Admin delete', async () => {
    const t = world();
    for (const user of ['usr_003', 'usr_002', 'usr_001']) {
      t.as('usr_003');
      const { entry } = await t.api.call('tracker.log', BASE);
      t.as(user);
      await t.api.call('tracker.delete', { id: entry.id });
      expect(t.store.state.tracker?.[entry.id]).toBeUndefined();
    }
  });

  it('refuses a team member who is not the author, and an outsider', async () => {
    const t = world();
    t.as('usr_002');
    const { entry } = await t.api.call('tracker.log', BASE);
    t.as('usr_003');
    const mine = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(mine[0]).toMatchObject({ canEdit: true, canDelete: false });
    await expect(t.api.call('tracker.delete', { id: entry.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('tracker.delete', { id: entry.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the person of an agent delete what the agent logged', async () => {
    const t = world();
    t.as('usr_005');
    const { entry } = await t.api.call('tracker.log', BASE);
    t.as('usr_003');
    await t.api.call('tracker.delete', { id: entry.id });
    expect(t.store.state.tracker?.[entry.id]).toBeUndefined();
  });

  it('brings the entry back with Undo', async () => {
    const t = world();
    const { entry } = await t.api.call('tracker.log', BASE);
    await t.api.call('tracker.delete', { id: entry.id }, { correlationId: 'cor_del' });
    expect(t.store.state.tracker?.[entry.id]).toBeUndefined();
    await t.api.call('events.undoStory', { correlationId: 'cor_del' });
    expect(t.store.state.tracker?.[entry.id]).toMatchObject({ title: BASE.title });
  });

  it('keeps the name of a deleted file as "removed" on the entry', async () => {
    const t = world();
    const { entry } = await t.api.call('tracker.log', { ...BASE, fileIds: ['fil_001'] });
    await t.api.call('files.delete', { id: 'fil_001' });
    const [row] = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(row.entry.id).toBe(entry.id);
    expect(row.files).toEqual([{ id: 'fil_001', name: null }]);
  });
});

describe('the automatic entries', () => {
  it('logs a File entry from the client when an upload says "received from the client"', async () => {
    const t = world();
    t.as('usr_003');
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Land survey.pdf', blob: pdf('x'), receivedFromClient: true });
    const [row] = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(row.entry).toMatchObject({
      type: 'file', direction: 'in', title: 'Land survey.pdf', note: 'Version A', fileIds: [view.file.id], auto: 'upload', waiting: null, createdBy: 'usr_003', date: '2026-09-30',
    });
  });

  it('logs nothing for a plain upload', async () => {
    const t = world();
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'Land survey.pdf', blob: pdf('x') });
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
  });

  it('names the new version when the file already exists', async () => {
    const t = world();
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'Land survey.pdf', blob: pdf('x') });
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'Land survey.pdf', blob: pdf('y'), receivedFromClient: true });
    const [row] = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(row.entry.note).toBe('Version B');
  });

  it('undoes the upload and its entry together', async () => {
    const t = world();
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Land survey.pdf', blob: pdf('x'), receivedFromClient: true }, { correlationId: 'cor_up' });
    await t.api.call('events.undoStory', { correlationId: 'cor_up' });
    expect(t.store.state.files[view.file.id]).toBeUndefined();
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
  });

  it('logs a File entry to the client when a file is marked as delivered', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('files.markDelivered', { id: 'fil_001' });
    expect(row.entry).toMatchObject({ type: 'file', direction: 'out', title: 'Survey.pdf', note: 'Version A', fileIds: ['fil_001'], auto: 'delivered', waiting: null });
    expect(await t.api.call('tracker.list', { projectId: 'prj_001', direction: 'out' })).toHaveLength(1);
  });

  it('refuses "delivered" for an outsider and for a missing file', async () => {
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('files.markDelivered', { id: 'fil_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await expect(t.api.call('files.markDelivered', { id: 'fil_099' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
