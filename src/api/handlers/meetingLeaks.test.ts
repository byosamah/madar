import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The privacy review of a meeting with no project (fbk_022, owner 2026-10-19, Q4): what a person who is not in the meeting must never
 * learn, not even that it exists. The Admin has no extra view here (this differs from an office task).
 *
 * Omar (usr_004) plans "Salary talk" with no project for Sara (usr_003) and Nour (usr_006). Faisal (usr_002) is on neither. Hala
 * (usr_001), the Admin, is not invited. usr_005 is the agent of Sara, and usr_008 is the agent of Hala. Later Omar takes Nour off.
 */
const ADMIN = 'usr_001';
const OUTSIDER = 'usr_002';
const ATTENDEE = 'usr_003';
const ORGANIZER = 'usr_004';
const AGENT_OF_ATTENDEE = 'usr_005';
const REMOVED = 'usr_006';
const AGENT_OF_ADMIN = 'usr_008';
const TITLE = 'Salary talk';
const NOTES = 'The raise is 4,000 riyals.';
const PEOPLE_WITHOUT_VIEW = [ADMIN, OUTSIDER, AGENT_OF_ADMIN];

async function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Lina Member' });
  t.store.state.users.usr_008 = makeUser('usr_008', { name: 'Hala Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
  t.store.state.counters.usr = 8;
  t.as(ORGANIZER);
  const meeting = await t.api.call('meetings.create', {
    kind: 'meeting', title: TITLE, startsAt: '2026-10-01T10:00:00+03:00', where: 'Room 4', notes: NOTES, attendeeIds: [ATTENDEE, REMOVED],
  });
  return { t, id: meeting.id };
}

type World = Awaited<ReturnType<typeof world>>;
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
const error = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: { reason?: string } };
    return { code, message, reason: details?.reason };
  }
};
/** Takes Nour off the meeting. */
async function removeNour(w: World) {
  await as(w, ORGANIZER, () => w.t.api.call('meetings.update', { id: w.id, attendeeIds: [ATTENDEE] }));
}

describe('meetings.list, meetings.get, meetings.update and meetings.cancel', () => {
  it('list no row of the meeting for a person who is not in it, with any filter', async () => {
    const w = await world();
    await removeNour(w);
    for (const person of [...PEOPLE_WITHOUT_VIEW, REMOVED]) {
      for (const input of [{}, { from: '2026-09-01', to: '2026-12-31' }, { mine: false, projectId: 'prj_001' }, { projectId: 'prj_001' }, { from: '2026-10-01', to: '2026-10-01' }] as const) {
        const rows = await as(w, person, () => w.t.api.call('meetings.list', input));
        expect(JSON.stringify(rows), `${person} ${JSON.stringify(input)}`).not.toContain(TITLE);
        expect(rows.map((row) => row.id), `${person} ${JSON.stringify(input)}`).not.toContain(w.id);
      }
    }
    // The people of the meeting do read it, also the agent of an attendee.
    for (const person of [ORGANIZER, ATTENDEE, AGENT_OF_ATTENDEE]) {
      expect((await as(w, person, () => w.t.api.call('meetings.list', {}))).map((row) => row.id), person).toEqual([w.id]);
    }
  });

  it('answer get, update and cancel for an outsider exactly as for an unknown id', async () => {
    const w = await world();
    await removeNour(w);
    for (const person of [...PEOPLE_WITHOUT_VIEW, REMOVED]) {
      for (const [name, input, missing] of [
        ['meetings.get', { id: w.id }, { id: 'mtg_999' }],
        ['meetings.update', { id: w.id, notes: 'x' }, { id: 'mtg_999', notes: 'x' }],
        ['meetings.update', { id: w.id, attendeeIds: [person] }, { id: 'mtg_999', attendeeIds: [person] }],
        ['meetings.cancel', { id: w.id }, { id: 'mtg_999' }],
      ] as const) {
        const hidden = await as(w, person, () => error(() => w.t.api.call(name, input as never)));
        const gone = await as(w, person, () => error(() => w.t.api.call(name, missing as never)));
        expect(hidden, `${person} ${name}`).toEqual({ ...gone, message: gone!.message.replace('mtg_999', w.id) });
        expect(hidden, `${person} ${name}`).toMatchObject({ code: 'not_found', message: `Meeting ${w.id} does not exist.` });
      }
    }
    // The meeting did not change.
    expect(w.t.store.state.meetings![w.id]).toMatchObject({ status: 'scheduled', notes: NOTES, rev: 1 });
  });

  it('give an attendee who is not the organizer the right to read, and refuse a change with forbidden, which the attendee may know', async () => {
    const w = await world();
    const got = await as(w, ATTENDEE, () => w.t.api.call('meetings.get', { id: w.id }));
    expect(got).toMatchObject({ title: TITLE, notes: NOTES, mine: true, viewerCan: { edit: false, cancel: false } });
    expect((await as(w, ATTENDEE, () => error(() => w.t.api.call('meetings.cancel', { id: w.id }))))?.code).toBe('forbidden');
  });

  it('show the meeting to an Admin who is invited, as to any attendee, without the right to change it', async () => {
    const w = await world();
    await as(w, ORGANIZER, () => w.t.api.call('meetings.update', { id: w.id, attendeeIds: [ATTENDEE, REMOVED, ADMIN] }));
    const got = await as(w, ADMIN, () => w.t.api.call('meetings.get', { id: w.id }));
    expect(got).toMatchObject({ title: TITLE, mine: true, viewerCan: { edit: false, cancel: false } });
    expect((await as(w, ADMIN, () => error(() => w.t.api.call('meetings.update', { id: w.id, notes: 'x' }))))?.code).toBe('forbidden');
  });

  it('keep a project meeting open to every person (the control)', async () => {
    const w = await world();
    const open = await as(w, 'usr_003', () => w.t.api.call('meetings.create', { kind: 'client', title: 'Open meeting', projectId: 'prj_001', startsAt: '2026-10-01T12:00:00+03:00' }));
    for (const person of [ADMIN, OUTSIDER, AGENT_OF_ADMIN, ORGANIZER]) {
      expect((await as(w, person, () => w.t.api.call('meetings.get', { id: open.id }))).title, person).toBe('Open meeting');
    }
  });
});

describe('the History of a meeting with no project', () => {
  it('holds no event of it for a person who is not in it, with any filter', async () => {
    const w = await world();
    await as(w, ORGANIZER, () => w.t.api.call('meetings.update', { id: w.id, where: 'Room 5' }));
    await removeNour(w);
    const event = Object.values(w.t.store.state.events).find((e) => e.verb === 'meeting.created')!;
    expect(event.officeMeetingId).toBe(w.id);
    for (const person of [...PEOPLE_WITHOUT_VIEW, REMOVED]) {
      for (const input of [
        { limit: 500 }, { targetType: 'meeting' as const, limit: 500 }, { targetType: 'meeting' as const, targetId: w.id }, { targetId: w.id },
        { correlationId: event.correlationId }, { since: '2026-09-01T00:00:00+03:00', limit: 500 },
      ]) {
        const seen = JSON.stringify(await as(w, person, () => w.t.api.call('events.list', input)));
        expect(seen, `${person} ${JSON.stringify(input)}`).not.toContain(w.id);
        expect(seen, `${person} ${JSON.stringify(input)}`).not.toContain(TITLE);
        expect(seen, `${person} ${JSON.stringify(input)}`).not.toContain('Room 5');
      }
    }
    const own = JSON.stringify(await as(w, ORGANIZER, () => w.t.api.call('events.list', { targetType: 'meeting', limit: 500 })));
    expect(own).toContain('meeting.created');
    expect(own).toContain('meeting.updated');
  });

  it('gives the event of every change the meeting of the change, also the Undo of it', async () => {
    const w = await world();
    await as(w, ORGANIZER, () => w.t.api.call('meetings.update', { id: w.id, where: 'Room 5' }));
    const changed = Object.values(w.t.store.state.events).find((e) => e.verb === 'meeting.updated')!;
    await as(w, ORGANIZER, () => w.t.api.call('events.undo', { eventId: changed.id }));
    const events = Object.values(w.t.store.state.events).filter((e) => e.targetType === 'meeting');
    expect(events.length).toBe(3);
    expect(events.every((e) => e.officeMeetingId === w.id)).toBe(true);
  });

  it('answers the Undo of such an event, and of its story, as for an event or a story that does not exist', async () => {
    const w = await world();
    await removeNour(w);
    const event = Object.values(w.t.store.state.events).find((e) => e.verb === 'meeting.created')!;
    for (const person of [...PEOPLE_WITHOUT_VIEW, REMOVED]) {
      const hidden = await as(w, person, () => error(() => w.t.api.call('events.undo', { eventId: event.id })));
      const gone = await as(w, person, () => error(() => w.t.api.call('events.undo', { eventId: 'evt_9999' })));
      expect(hidden, person).toEqual({ ...gone, message: gone!.message.replace('evt_9999', event.id) });
      expect(hidden, person).toMatchObject({ code: 'not_found' });
      const hiddenStory = await as(w, person, () => error(() => w.t.api.call('events.undoStory', { correlationId: event.correlationId })));
      const goneStory = await as(w, person, () => error(() => w.t.api.call('events.undoStory', { correlationId: 'cor_none' })));
      expect(hiddenStory, person).toEqual({ ...goneStory, message: goneStory!.message.replace('cor_none', event.correlationId) });
    }
    expect(w.t.store.state.meetings![w.id]).toBeDefined();
  });

  it('stays hidden from the outsider after the organizer takes the plan back with Undo', async () => {
    const w = await world();
    const event = Object.values(w.t.store.state.events).find((e) => e.verb === 'meeting.created')!;
    await as(w, ORGANIZER, () => w.t.api.call('events.undo', { eventId: event.id }));
    expect(w.t.store.state.meetings![w.id]).toBeUndefined();
    for (const person of [...PEOPLE_WITHOUT_VIEW, REMOVED, ATTENDEE]) {
      const seen = JSON.stringify(await as(w, person, () => w.t.api.call('events.list', { limit: 500 })));
      expect(seen, person).not.toContain(w.id);
      expect(seen, person).not.toContain(TITLE);
    }
  });
});

/**
 * The minutes of a meeting with no project (wave 2, owner 2026-10-19), and the file of its minutes. A person who is not in the
 * meeting, the Admin who is not invited, a person taken off the meeting and the agents of these people must learn nothing of them:
 * not the text, not the file name, not that the minutes exist.
 */
describe('the minutes of a meeting with no project', () => {
  const MINUTES = 'The raise is 4,000 riyals. MINUTES-LEAK-6103';
  const FILE = 'Hidden-minutes-file-6103.pdf';
  const AFTER_END = new Date('2026-10-01T08:30:00Z');

  async function withMinutes() {
    const w = await world();
    setNow(AFTER_END);
    const up = await as(w, ATTENDEE, () => w.t.api.call('files.upload', { name: FILE, meetingId: w.id, blob: new Blob(['x'], { type: 'application/pdf' }) }));
    await as(w, ATTENDEE, () => w.t.api.call('meetings.saveMinutes', { id: w.id, text: MINUTES, fileIds: [up.file.id] }));
    return { w, fileId: up.file.id };
  }

  it('answers get and the save for an outsider exactly as for an unknown id, and writes nothing', async () => {
    const { w } = await withMinutes();
    for (const person of [...PEOPLE_WITHOUT_VIEW, 'usr_007']) {
      for (const [name, input, missing] of [
        ['meetings.get', { id: w.id }, { id: 'mtg_999' }],
        ['meetings.saveMinutes', { id: w.id, text: 'Forged', fileIds: [] }, { id: 'mtg_999', text: 'Forged', fileIds: [] }],
        ['meetings.saveMinutes', { id: w.id, text: '', fileIds: [] }, { id: 'mtg_999', text: '', fileIds: [] }],
        ['meetings.settle', { id: w.id }, { id: 'mtg_999' }],
      ] as const) {
        const hidden = await as(w, person, () => error(() => w.t.api.call(name, input as never)));
        const gone = await as(w, person, () => error(() => w.t.api.call(name, missing as never)));
        expect(hidden, `${person} ${name}`).toEqual({ ...gone, message: gone!.message.replace('mtg_999', w.id) });
        expect(hidden, `${person} ${name}`).toMatchObject({ code: 'not_found', message: `Meeting ${w.id} does not exist.` });
      }
    }
    expect(w.t.store.state.meetings![w.id].minutes?.text).toBe(MINUTES);
  });

  it('puts no minutes key in a row of the list, for anyone', async () => {
    const { w } = await withMinutes();
    for (const person of [ORGANIZER, ATTENDEE, AGENT_OF_ATTENDEE, ...PEOPLE_WITHOUT_VIEW]) {
      const rows = await as(w, person, () => w.t.api.call('meetings.list', { from: '2026-09-01', to: '2026-12-31' }));
      expect(JSON.stringify(rows), person).not.toContain('MINUTES-LEAK');
      for (const row of rows) expect(row, person).not.toHaveProperty('minutes');
    }
  });

  it('holds no event of the save for a person who is not in the meeting, and the Undo of it answers as for a missing event', async () => {
    const { w } = await withMinutes();
    const event = Object.values(w.t.store.state.events).find((e) => e.verb === 'meeting.minutes_saved')!;
    expect(event.officeMeetingId).toBe(w.id);
    for (const person of [...PEOPLE_WITHOUT_VIEW, 'usr_007']) {
      for (const input of [{ limit: 500 }, { targetType: 'meeting' as const, limit: 500 }, { targetId: w.id }, { correlationId: event.correlationId }]) {
        const seen = JSON.stringify(await as(w, person, () => w.t.api.call('events.list', input)));
        expect(seen, `${person} ${JSON.stringify(input)}`).not.toContain('meeting.minutes_saved');
        expect(seen, `${person} ${JSON.stringify(input)}`).not.toContain('MINUTES-LEAK');
        expect(seen, `${person} ${JSON.stringify(input)}`).not.toContain(w.id);
      }
      const undo = await as(w, person, () => error(() => w.t.api.call('events.undo', { eventId: event.id })));
      const gone = await as(w, person, () => error(() => w.t.api.call('events.undo', { eventId: 'evt_9999' })));
      expect(undo, person).toEqual({ ...gone, message: gone!.message.replace('evt_9999', event.id) });
      const story = await as(w, person, () => error(() => w.t.api.call('events.undoStory', { correlationId: event.correlationId })));
      expect(story, person).toMatchObject({ code: 'not_found' });
    }
    expect(w.t.store.state.meetings![w.id].minutes?.text).toBe(MINUTES);
  });

  it('finds the words of the minutes and the file name in no search, files list, link, dashboard or notice', async () => {
    const { w, fileId } = await withMinutes();
    for (const person of [...PEOPLE_WITHOUT_VIEW, 'usr_007']) {
      const text = await as(w, person, async () => JSON.stringify([
        await w.t.api.call('search.query', { text: 'MINUTES-LEAK' }),
        await w.t.api.call('search.query', { text: 'Hidden-minutes' }),
        await w.t.api.call('search.query', { text: '6103' }),
        await w.t.api.call('files.list', { projectId: 'prj_001' }),
        await w.t.api.call('dashboard.get', {}),
        await w.t.api.call('notifications.list', {}),
        await w.t.api.call('projects.get', { id: 'prj_001' }),
      ]));
      expect(text, person).not.toContain('MINUTES-LEAK');
      expect(text, person).not.toContain('Hidden-minutes');
      expect(text, person).not.toContain(fileId);
      const link = await as(w, person, () => error(() => w.t.api.call('files.link', { id: fileId, variant: 'full', disposition: 'inline' })));
      expect(link, person).toMatchObject({ code: 'not_found', message: `File ${fileId} does not exist.` });
    }
  });

  it('gives a person taken off the meeting nothing of the minutes, and the agent of an attendee reads the text but never opens the file', async () => {
    const { w, fileId } = await withMinutes();
    // After the end the people no longer change through a call, so the record changes: the rule asks who sees the meeting now.
    w.t.store.state.meetings![w.id].attendeeIds = [ATTENDEE];
    const removed = await as(w, REMOVED, () => error(() => w.t.api.call('meetings.get', { id: w.id })));
    expect(removed).toMatchObject({ code: 'not_found' });
    const agent = await as(w, AGENT_OF_ATTENDEE, () => w.t.api.call('meetings.get', { id: w.id }));
    expect(agent.minutes).toMatchObject({ text: MINUTES, files: [{ id: fileId, name: FILE }] });
    for (const call of ['files.get', 'files.link'] as const) {
      const input = call === 'files.get' ? { id: fileId } : { id: fileId, variant: 'full' as const, disposition: 'inline' as const };
      expect(await as(w, AGENT_OF_ATTENDEE, () => error(() => w.t.api.call(call, input as never))), call).toMatchObject({ code: 'not_found' });
    }
  });

  it('keeps a project meeting open (the control): its minutes show to every person who opens the project', async () => {
    const { w } = await withMinutes();
    const open = await as(w, 'usr_003', () => w.t.api.call('meetings.create', { kind: 'team', title: 'Open team sync', projectId: 'prj_001', startsAt: '2026-10-02T09:00:00+03:00' }));
    setNow(new Date('2026-10-02T08:00:00Z'));
    await as(w, 'usr_003', () => w.t.api.call('meetings.saveMinutes', { id: open.id, text: 'Open minutes OPEN-6103', fileIds: [] }));
    for (const person of [ADMIN, OUTSIDER, AGENT_OF_ADMIN, ORGANIZER]) {
      expect((await as(w, person, () => w.t.api.call('meetings.get', { id: open.id }))).minutes?.text, person).toBe('Open minutes OPEN-6103');
    }
  });
});

