import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { now, setNow } from '../../lib/dates';
import { NOW, makeTask, makeUser, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/**
 * The files of a meeting with no project (fbk_022, wave 2, owner 2026-10-19). The file belongs to its meeting: exactly the people who
 * see the meeting open it, and the Admin only when invited. A project meeting, also a team meeting, uses the files of its project.
 *
 * Omar (usr_004) plans "Salary talk" with no project for Sara (usr_003) and Nour (usr_006). Faisal (usr_002) leads prj_001 and is not
 * invited. Hala (usr_001) is the Admin and is not invited. usr_005 is the agent of Sara, usr_008 the agent of Omar, and usr_009 the agent
 * of Hala. "Now" is 2026-09-30 09:00 in Riyadh; the meeting runs on 2026-10-01 from 10:00 to 11:00.
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const SARA = 'usr_003';
const OMAR = 'usr_004';
const NOUR = 'usr_006';
const SARA_AGENT = 'usr_005';
const OMAR_AGENT = 'usr_008';
const ADMIN_AGENT = 'usr_009';
const FILE = 'Hidden-minutes-7734.pdf';
const START = '2026-10-01T10:00:00+03:00';
const AFTER_END = new Date('2026-10-01T08:30:00Z');

const pdf = () => new Blob(['minutes'], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Lina Member' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Omar Agent', kind: 'agent', discipline: 'Agent', ownerId: OMAR });
  state.users.usr_009 = makeUser('usr_009', { name: 'Hala Agent', kind: 'agent', discipline: 'Agent', ownerId: ADMIN });
  state.tasks.tsk_001 = makeTask({ ownerId: SARA, createdBy: SARA });
  state.counters.usr = 9;
  state.counters.tsk = 1;
  t.as(OMAR);
  const hidden = await t.api.call('meetings.create', { kind: 'meeting', title: 'Salary talk', startsAt: START, attendeeIds: [SARA, NOUR] });
  t.as(SARA);
  const project = await t.api.call('meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: START, attendeeIds: [LEADER] });
  const team = await t.api.call('meetings.create', { kind: 'team', title: 'Team sync', projectId: 'prj_001', startsAt: START });
  return { t, hidden: hidden.id, project: project.id, team: team.id };
}

type World = Awaited<ReturnType<typeof world>>;
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: Record<string, unknown> }) => error);

/** The meeting is over for the rest of the test. */
const over = () => setNow(AFTER_END);

async function withFile(w: World, uploader = SARA) {
  over();
  const up = await as(w, uploader, () => w.t.api.call('files.upload', { name: FILE, meetingId: w.hidden, blob: pdf() }));
  return up.file.id;
}

describe('an attendee uploads a file of a meeting with no project', () => {
  it('saves the file with its meeting, on no project, no stage and no task, and writes no History event', async () => {
    const w = await world();
    over();
    const events = Object.keys(w.t.store.state.events).length;
    const up = await as(w, SARA, () => w.t.api.call('files.upload', { name: FILE, meetingId: w.hidden, blob: pdf() }));
    expect(w.t.store.state.files[up.file.id]).toMatchObject({ projectId: null, stageId: null, taskId: null, meetingId: w.hidden, name: FILE });
    expect(up.canDelete).toBe(false);
    expect(Object.keys(w.t.store.state.events)).toHaveLength(events);
  });

  it('lets the organizer and every attendee upload and open the file, and a second file with the same name is a new file', async () => {
    const w = await world();
    const first = await withFile(w);
    for (const person of [SARA, OMAR, NOUR]) {
      expect((await as(w, person, () => w.t.api.call('files.get', { id: first }))).file.file.name, person).toBe(FILE);
    }
    const again = await as(w, OMAR, () => w.t.api.call('files.upload', { name: FILE, meetingId: w.hidden, blob: pdf() }));
    expect(again.file.id).not.toBe(first);
    expect(again.file.versions.map((v) => v.letter)).toEqual(['A']);
  });

  it('lets an agent upload for its person, who is an attendee or the organizer, with the rights of the person', async () => {
    const w = await world();
    over();
    for (const agent of [SARA_AGENT, OMAR_AGENT]) {
      const up = await as(w, agent, () => w.t.api.call('files.upload', { name: `By-${agent}.pdf`, meetingId: w.hidden, blob: pdf() }));
      expect(w.t.store.state.files[up.file.id].meetingId, agent).toBe(w.hidden);
    }
  });
});

describe('who may upload', () => {
  it('refuses before the end with minutes_not_yet, and a cancelled meeting with meeting_cancelled', async () => {
    const w = await world();
    const early = await as(w, SARA, () => failureOf(w.t.api.call('files.upload', { name: FILE, meetingId: w.hidden, blob: pdf() })));
    expect(early).toMatchObject({ code: 'conflict', details: { reason: 'minutes_not_yet' } });
    const start = await as(w, SARA, () => failureOf(w.t.api.call('files.uploadStart', { name: FILE, meetingId: w.hidden, size: 1, mimeType: 'application/pdf' })));
    expect(start).toMatchObject({ code: 'conflict', details: { reason: 'minutes_not_yet' } });
    const other = await as(w, OMAR, () => w.t.api.call('meetings.create', { kind: 'meeting', title: 'Dropped', startsAt: START, attendeeIds: [SARA] }));
    await as(w, OMAR, () => w.t.api.call('meetings.cancel', { id: other.id }));
    over();
    const cancelled = await as(w, SARA, () => failureOf(w.t.api.call('files.upload', { name: FILE, meetingId: other.id, blob: pdf() })));
    expect(cancelled).toMatchObject({ code: 'conflict', details: { reason: 'meeting_cancelled' } });
  });

  it('refuses a project meeting, also a team meeting, with file_meeting: they use the files of their project', async () => {
    const w = await world();
    over();
    for (const id of [w.project, w.team]) {
      const upload = await as(w, SARA, () => failureOf(w.t.api.call('files.upload', { name: FILE, meetingId: id, blob: pdf() })));
      expect(upload, id).toMatchObject({ code: 'invalid_input', details: { reason: 'file_meeting' } });
      const start = await as(w, SARA, () => failureOf(w.t.api.call('files.uploadStart', { name: FILE, meetingId: id, size: 1, mimeType: 'application/pdf' })));
      expect(start, id).toMatchObject({ code: 'invalid_input', details: { reason: 'file_meeting' } });
    }
    expect(Object.values(w.t.store.state.files).filter((file) => file.name === FILE)).toEqual([]);
  });

  it('refuses a person who is not in the meeting, and the Admin who is not invited, as for a meeting that does not exist', async () => {
    const w = await world();
    over();
    for (const person of [LEADER, ADMIN, ADMIN_AGENT, 'usr_007']) {
      const upload = await as(w, person, () => failureOf(w.t.api.call('files.upload', { name: 'Leak.pdf', meetingId: w.hidden, blob: pdf() })));
      const unknown = await as(w, person, () => failureOf(w.t.api.call('files.upload', { name: 'Leak.pdf', meetingId: 'mtg_999', blob: pdf() })));
      expect(upload, person).toMatchObject({ code: 'not_found', message: `Meeting ${w.hidden} does not exist.` });
      expect(unknown, person).toMatchObject({ code: 'not_found', message: 'Meeting mtg_999 does not exist.' });
      const start = await as(w, person, () => failureOf(w.t.api.call('files.uploadStart', { name: 'Leak.pdf', meetingId: w.hidden, size: 1, mimeType: 'application/pdf' })));
      expect(start, person).toMatchObject({ code: 'not_found', message: `Meeting ${w.hidden} does not exist.` });
    }
    expect(Object.values(w.t.store.state.files).filter((file) => file.name === 'Leak.pdf')).toEqual([]);
  });

  it('lets the Admin upload when invited, and refuses a person taken off the meeting', async () => {
    const w = await world();
    await as(w, OMAR, () => w.t.api.call('meetings.update', { id: w.hidden, attendeeIds: [SARA, ADMIN] }));
    over();
    expect((await as(w, ADMIN, () => w.t.api.call('files.upload', { name: 'Admin.pdf', meetingId: w.hidden, blob: pdf() }))).file.name).toBe('Admin.pdf');
    const removed = await as(w, NOUR, () => failureOf(w.t.api.call('files.upload', { name: 'Nour.pdf', meetingId: w.hidden, blob: pdf() })));
    expect(removed).toMatchObject({ code: 'not_found', message: `Meeting ${w.hidden} does not exist.` });
  });

  it('refuses the mix of a meeting with a project, a chat, a stage, a task, a cover and a client mark', async () => {
    const w = await world();
    over();
    w.t.as(SARA);
    const base = { name: 'x.png', meetingId: w.hidden, blob: new Blob(['x'], { type: 'image/png' }) };
    for (const more of [{ projectId: 'prj_001' }, { conversationId: 'cnv_001' }, { stageId: 'stg_001' }, { taskId: 'tsk_001' }, { asCover: true }, { receivedFromClient: true }]) {
      await expect(w.t.api.call('files.upload', { ...base, ...more }), JSON.stringify(more)).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_meeting' } });
    }
  });
});

describe('an outsider and an Admin who is not invited see nothing of the file', () => {
  it('gets not_found, with no file name, from files.get and files.link', async () => {
    const w = await world();
    const id = await withFile(w);
    for (const person of [LEADER, ADMIN, ADMIN_AGENT, 'usr_007']) {
      const get = await as(w, person, () => failureOf(w.t.api.call('files.get', { id })));
      const link = await as(w, person, () => failureOf(w.t.api.call('files.link', { id, variant: 'full', disposition: 'inline' })));
      for (const refused of [get, link]) {
        expect(refused, `${person} ${id}`).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
        expect(JSON.stringify(refused)).not.toMatch(/Hidden-/);
      }
    }
  });

  it('finds the file in no files.list, no search and no History line', async () => {
    const w = await world();
    const id = await withFile(w);
    for (const person of [LEADER, ADMIN, ADMIN_AGENT, 'usr_007', SARA, SARA_AGENT, OMAR]) {
      const text = await as(w, person, async () => JSON.stringify([
        await w.t.api.call('files.list', { projectId: 'prj_001' }),
        await w.t.api.call('search.query', { text: 'Hidden' }),
        await w.t.api.call('search.query', { text: '7734' }),
        await w.t.api.call('events.list', { limit: 500 }),
        await w.t.api.call('projects.get', { id: 'prj_001' }),
      ]));
      expect(text, person).not.toMatch(/Hidden-/);
      expect(text, person).not.toContain(id);
    }
  });

  it('cannot put the id of the file into any other place: the file reads as missing', async () => {
    const w = await world();
    const id = await withFile(w);
    w.t.as(LEADER);
    const { id: chat } = await w.t.api.call('chats.openDirect', { userId: SARA });
    const missing = { code: 'invalid_input', details: { reason: 'file_missing' } };
    await expect(w.t.api.call('chats.send', { conversationId: chat, body: 'Look', fileIds: [id] })).rejects.toMatchObject(missing);
    await expect(w.t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Look', fileIds: [id] })).rejects.toMatchObject(missing);
    await expect(w.t.api.call('tracker.log', { projectId: 'prj_001', type: 'file', direction: 'in', title: 'Look', fileIds: [id] })).rejects.toMatchObject(missing);
    // A post gives its plain refusal for any file that is not a file of its project, as for a missing file.
    await expect(w.t.api.call('updates.create', { projectId: 'prj_001', body: 'Look', fileIds: [id] })).rejects.toMatchObject({ code: 'invalid_input', message: 'A file is not in this project.' });
  });

  it('cannot share, delete or mark the file as delivered: the file reads as missing', async () => {
    const w = await world();
    const id = await withFile(w);
    w.t.as(LEADER);
    const calls = [
      () => w.t.api.call('files.share', { fileId: id, target: { kind: 'person', userId: NOUR } }),
      () => w.t.api.call('files.delete', { id }),
      () => w.t.api.call('files.markDelivered', { id }),
    ];
    for (const run of calls) await expect(run()).rejects.toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
  });
});

describe('a file stays with its meeting', () => {
  it('cannot go into a chat, a task, a post or the Tracker, for an attendee: file_meeting', async () => {
    const w = await world();
    const id = await withFile(w);
    w.t.as(SARA);
    const { id: chat } = await w.t.api.call('chats.openDirect', { userId: NOUR });
    const reason = { code: 'invalid_input', details: { reason: 'file_meeting' } };
    await expect(w.t.api.call('chats.send', { conversationId: chat, body: 'Other', fileIds: [id] })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Other', fileIds: [id] })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('tracker.log', { projectId: 'prj_001', type: 'file', direction: 'in', title: 'Other', fileIds: [id] })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('updates.create', { projectId: 'prj_001', body: 'Other', fileIds: [id] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('cannot be shared, deleted or marked as delivered, for an attendee: file_meeting', async () => {
    const w = await world();
    const id = await withFile(w);
    w.t.as(SARA);
    const reason = { code: 'invalid_input', details: { reason: 'file_meeting' } };
    for (const target of [{ kind: 'project_chat' }, { kind: 'person', userId: NOUR }, { kind: 'task', taskId: 'tsk_001' }] as const) {
      await expect(w.t.api.call('files.share', { fileId: id, target }), target.kind).rejects.toMatchObject(reason);
    }
    await expect(w.t.api.call('files.delete', { id })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('files.markDelivered', { id })).rejects.toMatchObject(reason);
    expect(w.t.store.state.files[id]).toBeDefined();
  });

  it('does not count in the files of a project or in the file count of a task', async () => {
    const w = await world();
    await withFile(w);
    w.t.as(SARA);
    expect(await w.t.api.call('files.list', { projectId: 'prj_001' })).toEqual([]);
    expect((await w.t.api.call('tasks.get', { id: 'tsk_001' })).fileCount ?? 0).toBe(0);
  });
});

describe('the agent of an attendee', () => {
  it('uploads as its person but never opens the file', async () => {
    const w = await world();
    const id = await withFile(w);
    for (const call of ['files.get', 'files.link'] as const) {
      const input = call === 'files.get' ? { id } : { id, variant: 'full' as const, disposition: 'inline' as const };
      const refused = await as(w, SARA_AGENT, () => failureOf(w.t.api.call(call, input as never)));
      expect(refused, call).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
    }
  });
});

describe('the people of the meeting change', () => {
  it('shuts the file to a person who is taken off the meeting, and opens it to a person who is added', async () => {
    const w = await world();
    const id = await withFile(w);
    // After the end the people of a meeting no longer change (meeting_over), so the test changes the record: the rule asks who sees it now.
    w.t.store.state.meetings![w.hidden].attendeeIds = [SARA, 'usr_007'];
    await expect(as(w, NOUR, () => w.t.api.call('files.get', { id }))).rejects.toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
    expect((await as(w, 'usr_007', () => w.t.api.call('files.get', { id }))).file.file.name).toBe(FILE);
  });

  it('shuts the file to a person who turned off', async () => {
    const w = await world();
    const id = await withFile(w);
    w.t.store.state.users[NOUR].active = false;
    await expect(as(w, NOUR, () => w.t.api.call('files.get', { id }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps the clock of the test fixed after the end', () => {
    over();
    expect(now().toISOString()).toBe(AFTER_END.toISOString());
  });
});
