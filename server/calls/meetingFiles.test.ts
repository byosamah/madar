import { describe, expect, it } from 'vitest';
import type { Meeting, User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { insertIntents, type Intent } from '../files/intents';
import { fakeDeps } from '../test/fakes/deps';
import { filesLink, filesUploadHooks, filesUploadStart } from './files';

/**
 * The files of a meeting with no project on the server (fbk_022, wave 2, owner 2026-10-19): files.uploadStart, files.link and the
 * preflight of files.upload, on fake ports. A meeting file belongs to its meeting. Exactly the people who see the meeting sign a link
 * for it, the Admin only when invited. Every refusal answers as for a missing file or a missing meeting, with no file name in the text.
 */

/** 12:30 Riyadh on 2026-10-04. The meetings below ended at 11:00. */
const NOW = new Date('2026-10-04T09:30:00Z');

const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;

const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }),
  usr_002: user('usr_002'),
  usr_003: user('usr_003', { active: false }),
  usr_004: user('usr_004'),
  usr_005: user('usr_005'),
  usr_006: user('usr_006'),
  usr_011: user('usr_011', { kind: 'agent', ownerId: 'usr_002' }),
  usr_012: user('usr_012', { kind: 'agent', ownerId: 'usr_001' }),
};

const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {}, projectTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never }, members: {}, stages: {}, deadlines: {}, conversations: {}, subCompanies: {},
}, 1);

const meeting = (id: string, o: Partial<Meeting> = {}): Meeting => ({
  id, kind: 'meeting', title: `Talk ${id}`, projectId: null, startsAt: '2026-10-04T10:00:00.000+03:00', endsAt: '2026-10-04T11:00:00.000+03:00', where: '', guests: '', notes: '',
  organizerId: 'usr_002', attendeeIds: ['usr_004'], status: 'scheduled', rev: 1, createdBy: 'usr_002', createdAt: '2026-10-01T09:00:00.000+03:00', ...o,
});

const MEETINGS: Record<string, Meeting> = {
  // usr_002 organizes with usr_004. The Admin, usr_005 and usr_006 are not on it.
  mtg_001: meeting('mtg_001'),
  mtg_002: meeting('mtg_002', { kind: 'client', projectId: 'prj_001' }),
  // Ends later today.
  mtg_003: meeting('mtg_003', { startsAt: '2026-10-04T14:00:00.000+03:00', endsAt: '2026-10-04T15:00:00.000+03:00' }),
  mtg_004: meeting('mtg_004', { status: 'cancelled' }),
  // The Admin is invited.
  mtg_005: meeting('mtg_005', { organizerId: 'usr_004', attendeeIds: ['usr_001'] }),
};

const version = (o: Record<string, unknown> = {}) => ({
  letter: 'A', blobKey: 'meeting/mtg-001/upl-c/file', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: '2026-10-04T12:00:00+03:00', ...o,
});

function setup() {
  const db = fakeFilesDb({
    users: USERS,
    meetings: MEETINGS,
    files: {
      fil_070: { id: 'fil_070', projectId: null, taskId: null, meetingId: 'mtg_001', name: 'Hidden-minutes.pdf', versions: [version({ thumbKey: 'meeting/mtg-001/upl-c/thumb' })] },
      // The file of a meeting that is gone.
      fil_071: { id: 'fil_071', projectId: null, taskId: null, meetingId: 'mtg_404', name: 'Lost.pdf', versions: [version({ blobKey: 'meeting/mtg-404/upl-d/file' })] },
      fil_072: { id: 'fil_072', projectId: null, taskId: null, meetingId: 'mtg_005', name: 'Admin-meeting.pdf', versions: [version({ blobKey: 'meeting/mtg-005/upl-e/file' })] },
    },
  });
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const gets: { key: string; disposition: string }[] = [];
  const presignGet = deps.files.presignGet.bind(deps.files);
  deps.files.presignGet = async (key, get) => {
    gets.push({ key, ...get });
    return presignGet(key, get);
  };
  const ctx = (userId: string): ServerCallCtx => ({
    deps, principal: USERS[userId]?.kind === 'agent' ? { userId, agent: { clientId: 'cli-1' } } : { userId }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW,
  });
  return { db, deps, ctx, gets };
}

const START = { name: 'minutes.pdf', size: 1200, mimeType: 'application/pdf', meetingId: 'mtg_001' };
const LINK = { variant: 'full', disposition: 'inline' } as const;

describe('files.uploadStart for a meeting', () => {
  it('writes an intent with no project and a final key under meeting/<meeting>, and signs the file and its small picture', async () => {
    const { db, deps, ctx } = setup();
    const { output } = await filesUploadStart({ ...START, mimeType: 'image/jpeg', thumb: { size: 300, mimeType: 'image/webp' } }, ctx('usr_002'));
    const part = output.uploadId.replace('_', '-');
    expect(db.intents.get(output.uploadId)).toMatchObject({
      actorId: 'usr_002', projectId: null, stagingKey: `up/${part}/file`, key: `meeting/mtg-001/${part}/file`, thumbKey: `meeting/mtg-001/${part}/thumb`,
    });
    expect(output.put.url).toContain(`up/${part}/file`);
    expect(output.thumbPut).toBeDefined();
    expect(deps.files.calls.length).toBeGreaterThan(0);
    await expect(filesUploadStart(START, ctx('usr_004'))).resolves.toBeDefined();
    // The agent of the organizer signs for its person.
    await expect(filesUploadStart(START, ctx('usr_011'))).resolves.toBeDefined();
  });

  it('refuses a person who is not in the meeting, the Admin who is not invited, and a meeting that is gone, as for a meeting that does not exist', async () => {
    for (const [userId, meetingId] of [['usr_005', 'mtg_001'], ['usr_006', 'mtg_001'], ['usr_001', 'mtg_001'], ['usr_012', 'mtg_001'], ['usr_002', 'mtg_404']] as const) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart({ ...START, meetingId }, ctx(userId)), `${userId} ${meetingId}`)
        .rejects.toMatchObject({ code: 'not_found', message: `Meeting ${meetingId} does not exist.` });
      expect([deps.files.calls, db.intents.size], `${userId} ${meetingId}`).toEqual([[], 0]);
    }
  });

  it('lets the Admin start an upload when the Admin is invited', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, meetingId: 'mtg_005' }, ctx('usr_001'))).resolves.toBeDefined();
  });

  it('refuses a project meeting, a meeting before its end, a cancelled meeting, a stage, a task and a mix, before it signs', async () => {
    const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ['usr_002', { meetingId: 'mtg_002' }, { code: 'invalid_input', details: { reason: 'file_meeting' } }],
      ['usr_002', { meetingId: 'mtg_003' }, { code: 'conflict', details: { reason: 'minutes_not_yet' } }],
      ['usr_002', { meetingId: 'mtg_004' }, { code: 'conflict', details: { reason: 'meeting_cancelled' } }],
      ['usr_002', { stageId: 'stg_001' }, { code: 'invalid_input', details: { reason: 'file_meeting' } }],
      ['usr_002', { taskId: 'tsk_001' }, { code: 'invalid_input', details: { reason: 'file_meeting' } }],
      ['usr_002', { projectId: 'prj_001' }, { code: 'invalid_input', details: { reason: 'file_meeting' } }],
      ['usr_002', { conversationId: 'cnv_001' }, { code: 'invalid_input', details: { reason: 'file_meeting' } }],
    ];
    for (const [userId, more, error] of cases) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart({ ...START, ...more } as never, ctx(userId)), JSON.stringify(more)).rejects.toMatchObject(error);
      expect([deps.files.calls, db.intents.size]).toEqual([[], 0]);
    }
  });

  it('refuses a person who is off before it reads the meeting', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart(START, ctx('usr_003'))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a file over the limit of the active store', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, size: 60 * 1024 * 1024 }, ctx('usr_002'))).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large' } });
  });
});

describe('files.link for a meeting file', () => {
  it('signs for the organizer and the attendee, for the file and for its small picture', async () => {
    for (const userId of ['usr_002', 'usr_004']) {
      const { ctx, gets } = setup();
      await expect(filesLink({ id: 'fil_070', ...LINK }, ctx(userId)), userId).resolves.toMatchObject({ output: { name: 'Hidden-minutes.pdf' } });
      await expect(filesLink({ id: 'fil_070', variant: 'thumb', disposition: 'inline' }, ctx(userId)), userId).resolves.toBeDefined();
      expect(gets.map((g) => g.key)).toEqual(['meeting/mtg-001/upl-c/file', 'meeting/mtg-001/upl-c/thumb']);
    }
  });

  it('signs for the Admin who is invited', async () => {
    const { ctx } = setup();
    await expect(filesLink({ id: 'fil_072', ...LINK }, ctx('usr_001'))).resolves.toMatchObject({ output: { name: 'Admin-meeting.pdf' } });
  });

  it('answers not_found, with no file name, to a person who is not in the meeting, the Admin who is not invited, and an agent, and signs nothing', async () => {
    for (const [userId, id] of [['usr_005', 'fil_070'], ['usr_006', 'fil_070'], ['usr_001', 'fil_070'], ['usr_012', 'fil_070'], ['usr_011', 'fil_070'], ['usr_002', 'fil_072']] as const) {
      const { ctx, gets } = setup();
      for (const variant of ['full', 'thumb'] as const) {
        const refused = await filesLink({ id, variant, disposition: 'attachment' }, ctx(userId)).then(() => null, (error: { code: string; message: string; details?: unknown }) => error);
        expect(refused, `${userId} ${id} ${variant}`).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
        expect(JSON.stringify(refused)).not.toMatch(/Hidden|Admin-meeting/);
      }
      expect(gets, `${userId} ${id}`).toEqual([]);
    }
  });

  it('answers not_found to everyone, the Admin too, for a file whose meeting is gone', async () => {
    for (const userId of ['usr_001', 'usr_002']) {
      const { ctx, gets } = setup();
      await expect(filesLink({ id: 'fil_071', ...LINK }, ctx(userId)), userId).rejects.toMatchObject({ code: 'not_found', message: 'File fil_071 does not exist.' });
      expect(gets).toEqual([]);
    }
  });

  it('refuses a person who is off, as it does for any file', async () => {
    const { ctx } = setup();
    await expect(filesLink({ id: 'fil_070', ...LINK }, ctx('usr_003'))).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('the preflight of files.upload for a meeting', () => {
  const intent = (o: Partial<Intent> = {}): Intent => ({
    id: 'upl_a', actorId: 'usr_002', projectId: null, stagingKey: 'up/upl-a/file', key: 'meeting/mtg-001/upl-a/file', thumbKey: null, size: 12,
    mimeType: 'application/pdf', expiresAt: new Date('2026-10-04T11:00:00Z'), usedAt: null, ...o,
  });
  const upload = { uploadId: 'upl_a', name: 'minutes.pdf', stageId: null, taskId: null, asCover: false, receivedFromClient: false, meetingId: 'mtg_001' };
  const run = async (stored: Intent, input: Record<string, unknown>) => {
    const s = setup();
    await insertIntents(s.db, [stored]);
    s.deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'application/pdf' });
    return filesUploadHooks.preflight!(input, { actorId: 'usr_002', now: NOW, deps: s.deps });
  };

  it('takes a meeting intent only for the meeting that the call names', async () => {
    await expect(run(intent(), upload)).resolves.toMatchObject({ blobKey: 'meeting/mtg-001/upl-a/file' });
    await expect(run(intent(), { ...upload, meetingId: 'mtg_005' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('never takes a meeting intent for a project, an office task, a chat or a screenshot, and never takes those for a meeting', async () => {
    const { meetingId: _meeting, ...plain } = upload;
    await expect(run(intent(), { ...plain, projectId: 'prj_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent(), { ...plain, taskId: 'tsk_050' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent(), { ...plain, conversationId: 'cnv_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ projectId: 'prj_001', key: 'prj-001/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ key: 'office/tsk-050/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ key: 'chat/cnv-001/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ key: 'feedback/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('takes the intent of the same person only', async () => {
    await expect(run(intent({ actorId: 'usr_004' }), upload)).rejects.toMatchObject({ code: 'not_found' });
  });
});
