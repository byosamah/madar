import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { memberKey } from '../rowKeys';
import { now, setNow } from '../../lib/dates';
import { NOW, makeUser, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/**
 * The minutes of a meeting (fbk_022, wave 2, owner 2026-10-19): one text with files, written and changed by any attendee. A project
 * meeting that is not a team meeting keeps them on its Tracker line. A meeting with no project, and a team meeting, keep them on the
 * meeting itself. No minutes task, no notice, no badge.
 *
 * The world of the factories: Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar
 * (usr_004) is on no team, usr_005 is the agent of Sara. Nour (usr_006) is on the team of prj_001 and attends nothing. Reem (usr_007)
 * is a Member on no team. "Now" is 2026-09-30 09:00; the meetings run on 2026-10-01 from 10:00 to 11:00.
 */
const START = '2026-10-01T10:00:00+03:00';
const AFTER_END = new Date('2026-10-01T08:30:00Z');
const TEXT = 'We agreed on the facade. Faisal sends the drawings on Sunday.';

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Team' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Reem Member' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  state.counters.usr = 7;
  t.as('usr_003');
  const client = await t.api.call('meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: START, attendeeIds: ['usr_002'] });
  const team = await t.api.call('meetings.create', { kind: 'team', title: 'Team sync', projectId: 'prj_001', startsAt: START, attendeeIds: ['usr_002'] });
  t.as('usr_004');
  const solo = await t.api.call('meetings.create', { kind: 'meeting', title: 'Salary talk', startsAt: START, attendeeIds: ['usr_003'] });
  return { t, client: client.id, team: team.id, solo: solo.id };
}

type World = Awaited<ReturnType<typeof world>>;
const over = () => setNow(AFTER_END);
/** Moves the clock a number of minutes after the end: two saves in one millisecond cannot tell their stamps apart. */
const later = (minutes: number) => setNow(new Date(AFTER_END.getTime() + minutes * 60_000));
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { reason?: string } }) => error);
const save = (w: World, userId: string, input: { id: string; text?: string; fileIds?: string[]; since?: string | null }) =>
  as(w, userId, () => w.t.api.call('meetings.saveMinutes', { text: TEXT, fileIds: [], ...input }));
const lines = (w: World) => Object.values(w.t.store.state.tracker ?? {}).filter((entry) => entry.auto === 'meeting');
const counts = (w: World) => ({ events: Object.keys(w.t.store.state.events).length, notices: Object.keys(w.t.store.state.notifications).length, tasks: Object.keys(w.t.store.state.tasks).length });

describe('the minutes of a project meeting live on its Tracker line', () => {
  it('lets an attendee write them before the job ran: the call settles first, and the line holds the text and the writer', async () => {
    const w = await world();
    over();
    const detail = await save(w, 'usr_002', { id: w.client });
    expect(lines(w)).toHaveLength(1);
    const [line] = lines(w);
    expect(line.minutes).toEqual({ text: TEXT, fileIds: [], updatedBy: 'usr_002', updatedAt: '2026-10-01T11:30:00.000+03:00' });
    expect(detail).toMatchObject({ minutesPlace: 'tracker', minutes: { text: TEXT, updatedBy: { id: 'usr_002' } }, viewerCan: { minutes: true }, settledAt: '2026-10-01T11:30:00.000+03:00' });
    expect(detail.trackerEntry).toEqual({ id: line.id, title: 'Review the facade' });
    expect(w.t.store.state.meetings![w.client]).not.toHaveProperty('minutes');
    // The read gives the same.
    expect(await as(w, 'usr_003', () => w.t.api.call('meetings.get', { id: w.client }))).toMatchObject({ minutesPlace: 'tracker', minutes: { text: TEXT } });
  });

  it('writes the event on the line with the old and the new minutes, and no event on the meeting', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    const events = Object.values(w.t.store.state.events).filter((event) => event.verb === 'tracker.minutes_saved');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetType: 'tracker', targetId: lines(w)[0].id, projectId: 'prj_001', before: { minutes: null } });
    expect(Object.values(w.t.store.state.events).filter((event) => event.verb === 'meeting.minutes_saved')).toEqual([]);
  });

  it('lets the organizer, an attendee and the Admin who is not invited write them, each time as the writer of the save', async () => {
    const w = await world();
    over();
    // Sara organizes, Faisal attends and leads the project, the Admin is not invited.
    for (const person of ['usr_003', 'usr_002', 'usr_001']) {
      const detail = await save(w, person, { id: w.client, text: `By ${person}` });
      expect(detail.minutes?.text, person).toBe(`By ${person}`);
      expect(detail.minutes?.updatedBy.id, person).toBe(person);
    }
  });

  it('refuses a team member who did not attend, and a person outside the project, with forbidden', async () => {
    const w = await world();
    over();
    for (const person of ['usr_006', 'usr_007']) {
      expect(await failureOf(save(w, person, { id: w.client })), person).toMatchObject({ code: 'forbidden' });
    }
    expect(lines(w)).toHaveLength(0);
  });

  it('lets the leader who is not invited write them, when the leader did not plan or attend the meeting', async () => {
    const w = await world();
    // Nour (a team member) plans a client meeting of the project with nobody else. The leader (Faisal) is not invited.
    const made = await as(w, 'usr_006', () => w.t.api.call('meetings.create', { kind: 'client', title: 'Nour meeting', projectId: 'prj_001', startsAt: START }));
    over();
    expect((await save(w, 'usr_002', { id: made.id })).minutes?.text).toBe(TEXT);
    expect((await save(w, 'usr_001', { id: made.id, text: 'Admin version' })).minutes?.text).toBe('Admin version');
  });

  it('settles only once: a second save finds the mark and the line, and the job finds nothing to settle', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    const marks = () => Object.values(w.t.store.state.events).filter((event) => event.verb === 'meeting.settled' && event.targetId === w.client);
    expect(marks()).toHaveLength(1);
    await save(w, 'usr_003', { id: w.client, text: 'Second' });
    expect(marks()).toHaveLength(1);
    expect(lines(w)).toHaveLength(1);
    expect(await w.t.api.call('meetings.settle', { id: w.client })).toMatchObject({ trackerEntryId: lines(w)[0].id });
  });

  it('works after the job settled the meeting: the line is there, and the save only changes the minutes', async () => {
    const w = await world();
    over();
    await as(w, 'usr_003', () => w.t.api.call('meetings.settle', { id: w.client }));
    const marks = Object.values(w.t.store.state.events).filter((event) => event.verb === 'meeting.settled').length;
    await save(w, 'usr_002', { id: w.client });
    expect(Object.values(w.t.store.state.events).filter((event) => event.verb === 'meeting.settled')).toHaveLength(marks);
    expect(lines(w)[0].minutes?.text).toBe(TEXT);
  });
});

describe('the minutes of a team meeting and of a meeting with no project live on the meeting', () => {
  it('keeps them on the meeting for a team meeting of a project, with no Tracker line', async () => {
    const w = await world();
    over();
    const detail = await save(w, 'usr_002', { id: w.team });
    expect(detail).toMatchObject({ minutesPlace: 'meeting', minutes: { text: TEXT, updatedBy: { id: 'usr_002' } }, viewerCan: { minutes: true } });
    expect(w.t.store.state.meetings![w.team].minutes).toMatchObject({ text: TEXT, updatedBy: 'usr_002' });
    expect(lines(w)).toHaveLength(0);
    const event = Object.values(w.t.store.state.events).find((one) => one.verb === 'meeting.minutes_saved')!;
    expect(event).toMatchObject({ targetType: 'meeting', targetId: w.team, projectId: 'prj_001', before: { minutes: undefined } });
    expect(event.officeMeetingId).toBeUndefined();
  });

  it('keeps them on the meeting for a meeting with no project, and the event is private to its people', async () => {
    const w = await world();
    over();
    const detail = await save(w, 'usr_003', { id: w.solo });
    expect(detail).toMatchObject({ minutesPlace: 'meeting', minutes: { text: TEXT } });
    const event = Object.values(w.t.store.state.events).find((one) => one.verb === 'meeting.minutes_saved')!;
    expect(event).toMatchObject({ targetId: w.solo, projectId: null, officeMeetingId: w.solo });
    expect(lines(w)).toHaveLength(0);
  });

  it('lets the Admin write the minutes of a meeting with no project only when invited', async () => {
    const w = await world();
    const hidden = await failureOf(save(w, 'usr_001', { id: w.solo }));
    expect(hidden).toMatchObject({ code: 'not_found', message: `Meeting ${w.solo} does not exist.` });
    // The organizer cannot add people after the end, so the Admin is invited before it.
    await as(w, 'usr_004', () => w.t.api.call('meetings.update', { id: w.solo, attendeeIds: ['usr_003', 'usr_001'] }));
    over();
    expect((await save(w, 'usr_001', { id: w.solo })).minutes?.text).toBe(TEXT);
  });

  it('refuses a person who is not in a meeting with no project as for a meeting that does not exist', async () => {
    const w = await world();
    over();
    for (const person of ['usr_002', 'usr_006', 'usr_007', 'usr_001']) {
      const refused = await failureOf(save(w, person, { id: w.solo }));
      const unknown = await failureOf(save(w, person, { id: 'mtg_999' }));
      expect(refused, person).toMatchObject({ code: 'not_found', message: `Meeting ${w.solo} does not exist.` });
      expect(unknown, person).toMatchObject({ code: 'not_found', message: 'Meeting mtg_999 does not exist.' });
    }
  });
});

describe('the refusals', () => {
  it('waits for the end with minutes_not_yet, and gives nothing for a cancelled meeting', async () => {
    const w = await world();
    expect(await failureOf(save(w, 'usr_002', { id: w.client }))).toMatchObject({ code: 'conflict', details: { reason: 'minutes_not_yet' } });
    await as(w, 'usr_003', () => w.t.api.call('meetings.cancel', { id: w.client }));
    over();
    expect(await failureOf(save(w, 'usr_002', { id: w.client }))).toMatchObject({ code: 'conflict', details: { reason: 'meeting_cancelled' } });
    // At the end exactly, the minutes open.
    const w2 = await world();
    setNow(new Date('2026-10-01T08:00:00Z'));
    expect((await save(w2, 'usr_002', { id: w2.client })).minutes?.text).toBe(TEXT);
  });

  it('refuses a project meeting whose Tracker line is gone with minutes_line_gone, and works again when the delete is undone', async () => {
    const w = await world();
    over();
    await as(w, 'usr_003', () => w.t.api.call('meetings.settle', { id: w.client }));
    const [line] = lines(w);
    await as(w, 'usr_003', () => w.t.api.call('tracker.delete', { id: line.id }));
    expect(await failureOf(save(w, 'usr_002', { id: w.client }))).toMatchObject({ code: 'conflict', details: { reason: 'minutes_line_gone' } });
    const detail = await as(w, 'usr_002', () => w.t.api.call('meetings.get', { id: w.client }));
    expect(detail.viewerCan.minutes).toBe(false);
    const deleted = Object.values(w.t.store.state.events).find((event) => event.verb === 'tracker.deleted')!;
    await as(w, 'usr_003', () => w.t.api.call('events.undo', { eventId: deleted.id }));
    expect((await save(w, 'usr_002', { id: w.client })).minutes?.text).toBe(TEXT);
  });

  it('refuses a save after another person saved, when the screen says what it opened (minutes_changed), and keeps the saved text', async () => {
    const w = await world();
    over();
    const first = await save(w, 'usr_002', { id: w.client, since: null });
    expect(first.minutes?.text).toBe(TEXT);
    // Sara opened the minutes before Faisal saved them: she sent since null.
    later(1);
    expect(await failureOf(save(w, 'usr_003', { id: w.client, text: 'Sara text', since: null }))).toMatchObject({ code: 'conflict', details: { reason: 'minutes_changed' } });
    expect(lines(w)[0].minutes?.text).toBe(TEXT);
    // With the value that she opened, the save passes. A save with no since is never checked.
    const second = await save(w, 'usr_003', { id: w.client, text: 'Sara text', since: first.minutes!.updatedAt });
    expect(second.minutes?.text).toBe('Sara text');
    later(2);
    expect((await save(w, 'usr_002', { id: w.client, text: 'Last word' })).minutes?.text).toBe('Last word');
    expect(await failureOf(save(w, 'usr_003', { id: w.client, text: 'Late', since: second.minutes!.updatedAt }))).toMatchObject({ details: { reason: 'minutes_changed' } });
  });

  it('checks since on a meeting with no project too, and null counts as a value', async () => {
    const w = await world();
    over();
    expect(await failureOf(save(w, 'usr_003', { id: w.solo, since: '2026-10-01T11:00:00.000+03:00' }))).toMatchObject({ details: { reason: 'minutes_changed' } });
    const first = await save(w, 'usr_003', { id: w.solo, since: null });
    later(1);
    expect(await failureOf(save(w, 'usr_004', { id: w.solo, text: 'Other', since: null }))).toMatchObject({ details: { reason: 'minutes_changed' } });
    expect((await save(w, 'usr_004', { id: w.solo, text: 'Other', since: first.minutes!.updatedAt })).minutes?.text).toBe('Other');
  });

  it('refuses a text of more than 10,000 letters, and trims the text', async () => {
    const w = await world();
    over();
    expect(await failureOf(save(w, 'usr_002', { id: w.client, text: 'x'.repeat(10_001) }))).toMatchObject({ code: 'invalid_input' });
    expect((await save(w, 'usr_002', { id: w.client, text: '  Line one\n\nLine two  ' })).minutes?.text).toBe('Line one\n\nLine two');
    expect((await save(w, 'usr_002', { id: w.client, text: 'x'.repeat(10_000) })).minutes?.text).toHaveLength(10_000);
  });
});

describe('an empty save, and a save that changes nothing', () => {
  it('clears the minutes with an empty text and no files, and the right to write stays', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    const cleared = await save(w, 'usr_002', { id: w.client, text: '   ' });
    expect(cleared.minutes).toBeNull();
    expect(cleared.viewerCan.minutes).toBe(true);
    expect(lines(w)[0].minutes).toBeNull();
    expect(cleared.minutesPlace).toBe('tracker');
  });

  it('writes nothing when the text and the files stay the same, and does not change who wrote them', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    const before = counts(w);
    const again = await save(w, 'usr_003', { id: w.client });
    expect(counts(w)).toEqual(before);
    expect(again.minutes?.updatedBy.id).toBe('usr_002');
    // An empty save on empty minutes writes nothing either.
    await save(w, 'usr_002', { id: w.team, text: '' });
    expect(Object.values(w.t.store.state.events).filter((event) => event.verb === 'meeting.minutes_saved')).toEqual([]);
  });
});

describe('Undo', () => {
  it('brings the old minutes back, for the person who wrote them, and refuses a team member who did not attend', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client, text: 'First' });
    await save(w, 'usr_002', { id: w.client, text: 'Second' });
    const second = Object.values(w.t.store.state.events).filter((event) => event.verb === 'tracker.minutes_saved').at(-1)!;
    expect(await as(w, 'usr_006', () => failureOf(w.t.api.call('events.undo', { eventId: second.id })))).toMatchObject({ code: 'forbidden' });
    await as(w, 'usr_002', () => w.t.api.call('events.undo', { eventId: second.id }));
    expect(lines(w)[0].minutes?.text).toBe('First');
  });

  it('brings the old minutes back on the meeting itself', async () => {
    const w = await world();
    over();
    await save(w, 'usr_003', { id: w.solo, text: 'Private first' });
    await save(w, 'usr_003', { id: w.solo, text: 'Private second' });
    const events = Object.values(w.t.store.state.events).filter((event) => event.verb === 'meeting.minutes_saved');
    await as(w, 'usr_003', () => w.t.api.call('events.undo', { eventId: events.at(-1)!.id }));
    expect(w.t.store.state.meetings![w.solo].minutes?.text).toBe('Private first');
    // The first save came from empty minutes: its Undo clears them.
    await as(w, 'usr_003', () => w.t.api.call('events.undo', { eventId: events[0].id }));
    expect(w.t.store.state.meetings![w.solo].minutes ?? null).toBeNull();
  });

  it('takes back only the minutes when the save settled the meeting on the way: the mark and the line stay', async () => {
    const w = await world();
    over();
    const { storyId, changed } = await as(w, 'usr_002', () => w.t.api.run('meetings.saveMinutes', { id: w.client, text: TEXT, fileIds: [] }));
    expect(changed).toBe(true);
    expect(lines(w)).toHaveLength(1);
    const settledAt = w.t.store.state.meetings![w.client].settledAt;
    expect(settledAt).toBeTruthy();
    await as(w, 'usr_002', () => w.t.api.call('events.undoStory', { correlationId: storyId }));
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0].minutes).toBeNull();
    expect(w.t.store.state.meetings![w.client].settledAt).toBe(settledAt);
  });

  it('lets the Undo of the line delete it only while no minutes stand on it', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    const logged = Object.values(w.t.store.state.events).find((event) => event.verb === 'tracker.logged' && event.targetId === lines(w)[0].id)!;
    // Faisal made the line (his save settled the meeting), so the Undo of the line is his.
    await expect(as(w, 'usr_002', () => w.t.api.call('events.undo', { eventId: logged.id }))).rejects.toMatchObject({ code: 'conflict' });
    const minutes = Object.values(w.t.store.state.events).find((event) => event.verb === 'tracker.minutes_saved')!;
    await as(w, 'usr_002', () => w.t.api.call('events.undo', { eventId: minutes.id }));
    await as(w, 'usr_002', () => w.t.api.call('events.undo', { eventId: logged.id }));
    expect(lines(w)).toHaveLength(0);
  });
});

describe('the files of the minutes', () => {
  const pdf = () => new Blob(['minutes'], { type: 'application/pdf' });

  it('takes a file of the project on the line of a project meeting', async () => {
    const w = await world();
    over();
    const up = await as(w, 'usr_002', () => w.t.api.call('files.upload', { name: 'Facade.pdf', projectId: 'prj_001', blob: pdf() }));
    const detail = await save(w, 'usr_002', { id: w.client, fileIds: [up.file.id] });
    expect(detail.minutes?.files).toEqual([{ id: up.file.id, name: 'Facade.pdf', mimeType: 'application/pdf' }]);
    expect(lines(w)[0].minutes?.fileIds).toEqual([up.file.id]);
  });

  it('takes only the files of its own meeting for a meeting with no project', async () => {
    const w = await world();
    over();
    const own = await as(w, 'usr_003', () => w.t.api.call('files.upload', { name: 'Notes.pdf', meetingId: w.solo, blob: pdf() }));
    const detail = await save(w, 'usr_003', { id: w.solo, fileIds: [own.file.id] });
    expect(detail.minutes?.files).toEqual([{ id: own.file.id, name: 'Notes.pdf', mimeType: 'application/pdf' }]);
    // A file of the project, and the file of another meeting, read as missing.
    const project = await as(w, 'usr_002', () => w.t.api.call('files.upload', { name: 'Plan.pdf', projectId: 'prj_001', blob: pdf() }));
    const refused = await failureOf(save(w, 'usr_003', { id: w.solo, fileIds: [project.file.id] }));
    expect(refused).toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
    const w2 = await world();
    over();
    const foreign = await as(w2, 'usr_003', () => w2.t.api.call('files.upload', { name: 'Notes.pdf', meetingId: w2.solo, blob: pdf() }));
    const other = await as(w2, 'usr_003', () => w2.t.api.call('meetings.create', { kind: 'meeting', title: 'Second talk', startsAt: START }));
    const missing = await failureOf(save(w2, 'usr_003', { id: other.id, fileIds: [foreign.file.id] }));
    expect(missing).toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
  });

  it('refuses a meeting file on the line of a project meeting with file_meeting, and a file that does not exist with file_missing', async () => {
    const w = await world();
    over();
    const own = await as(w, 'usr_003', () => w.t.api.call('files.upload', { name: 'Notes.pdf', meetingId: w.solo, blob: pdf() }));
    expect(await failureOf(save(w, 'usr_003', { id: w.client, fileIds: [own.file.id] }))).toMatchObject({ details: { reason: 'file_meeting' } });
    expect(await failureOf(save(w, 'usr_003', { id: w.client, fileIds: ['fil_404'] }))).toMatchObject({ details: { reason: 'file_missing' } });
    expect(await failureOf(save(w, 'usr_003', { id: w.client, fileIds: Array.from({ length: 11 }, (_, n) => `fil_${String(n + 1).padStart(3, '0')}`) }))).toMatchObject({ code: 'invalid_input' });
  });

  it('saves a file alone, with no text', async () => {
    const w = await world();
    over();
    const own = await as(w, 'usr_003', () => w.t.api.call('files.upload', { name: 'Notes.pdf', meetingId: w.solo, blob: pdf() }));
    const detail = await save(w, 'usr_003', { id: w.solo, text: '', fileIds: [own.file.id] });
    expect(detail.minutes).toMatchObject({ text: '', files: [{ name: 'Notes.pdf' }] });
  });

  it('shows a person only the files of the minutes that the person may see', async () => {
    const w = await world();
    over();
    const own = await as(w, 'usr_003', () => w.t.api.call('files.upload', { name: 'Notes.pdf', meetingId: w.solo, blob: pdf() }));
    await save(w, 'usr_003', { id: w.solo, fileIds: [own.file.id] });
    // Take Omar (the organizer) off in the record: he still sees the meeting. Reem is not in it and cannot read it at all.
    expect((await as(w, 'usr_004', () => w.t.api.call('meetings.get', { id: w.solo }))).minutes?.files).toHaveLength(1);
    expect(await as(w, 'usr_007', () => failureOf(w.t.api.call('meetings.get', { id: w.solo })))).toMatchObject({ code: 'not_found' });
  });
});

describe('no task, no notice, no badge', () => {
  it('makes no task, no notice and no mark for anyone, also for the settle on the way', async () => {
    const w = await world();
    over();
    const before = counts(w);
    await save(w, 'usr_002', { id: w.client });
    await save(w, 'usr_003', { id: w.solo });
    await save(w, 'usr_002', { id: w.team });
    const after = counts(w);
    expect(after.notices).toBe(before.notices);
    expect(after.tasks).toBe(before.tasks);
    // The bell and the Inbox of every person show nothing new: no notice names a meeting for the minutes.
    for (const person of ['usr_002', 'usr_003', 'usr_004', 'usr_001']) {
      const notices = await as(w, person, () => w.t.api.call('notifications.list', {}));
      expect(notices.filter((view) => view.notification.createdAt >= '2026-10-01T11:00:00'), person).toEqual([]);
    }
  });
});

describe('an agent', () => {
  it('writes the minutes for its person, with the person as the writer and the agent as the actor', async () => {
    const w = await world();
    over();
    const detail = await save(w, 'usr_005', { id: w.client });
    expect(detail.minutes?.updatedBy.id).toBe('usr_003');
    const event = Object.values(w.t.store.state.events).find((one) => one.verb === 'tracker.minutes_saved')!;
    expect(event).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003', actorKind: 'agent' });
  });
});

describe('the Tracker line as a row', () => {
  it('gives the row of an auto meeting line the meeting, the minutes and the right of the viewer, and other lines none of the three', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    w.t.as('usr_002');
    await w.t.api.call('tracker.log', { projectId: 'prj_001', type: 'message', direction: 'in', title: 'A plain line' });
    const rows = await w.t.api.call('tracker.list', { projectId: 'prj_001' });
    const meetingRow = rows.find((row) => row.entry.auto === 'meeting')!;
    expect(meetingRow).toMatchObject({ meeting: { id: w.client, title: 'Review the facade' }, minutes: { text: TEXT, updatedBy: { id: 'usr_002' } }, canEditMinutes: true });
    const plain = rows.find((row) => row.entry.title === 'A plain line')!;
    expect(plain).not.toHaveProperty('meeting');
    expect(plain).not.toHaveProperty('minutes');
    expect(plain).not.toHaveProperty('canEditMinutes');
    // A team member who did not attend reads the minutes and cannot write them.
    const nour = (await as(w, 'usr_006', () => w.t.api.call('tracker.list', { projectId: 'prj_001' }))).find((row) => row.entry.auto === 'meeting')!;
    expect(nour).toMatchObject({ minutes: { text: TEXT }, canEditMinutes: false });
  });

  it('never takes the minutes or the meeting from tracker.log and tracker.update', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    const [line] = lines(w);
    w.t.as('usr_002');
    const forged = { text: 'Forged', fileIds: [], updatedBy: 'usr_002', updatedAt: '2026-10-01T12:00:00.000+03:00' };
    await w.t.api.call('tracker.update', { id: line.id, note: 'Edited note', minutes: forged, meetingId: 'mtg_999' } as never);
    expect(w.t.store.state.tracker![line.id]).toMatchObject({ note: 'Edited note', meetingId: w.client, minutes: { text: TEXT } });
    const logged = await w.t.api.call('tracker.log', { projectId: 'prj_001', type: 'meeting', direction: 'both', title: 'By hand', minutes: forged, meetingId: w.client } as never);
    expect(logged.entry).not.toHaveProperty('meetingId');
    expect(logged.entry).not.toHaveProperty('minutes');
  });
});

describe('the feed', () => {
  it('shows the event of the minutes of a project meeting in the project feed, and not the event of a meeting with no project', async () => {
    const w = await world();
    over();
    await save(w, 'usr_002', { id: w.client });
    await save(w, 'usr_003', { id: w.solo });
    await save(w, 'usr_002', { id: w.team });
    const feed = await as(w, 'usr_001', () => w.t.api.call('updates.list', { projectId: 'prj_001', filter: 'all' }));
    const verbs = feed.flatMap((item) => (item.kind === 'event' ? [item.verb] : []));
    expect(verbs).toContain('tracker.minutes_saved');
    expect(verbs).toContain('meeting.minutes_saved');
    expect(verbs).not.toContain('meeting.settled');
    const text = JSON.stringify(feed);
    expect(text).not.toContain('Salary talk');
  });

  it('keeps the clock of the test at the end of the meetings', () => {
    over();
    expect(now().toISOString()).toBe(AFTER_END.toISOString());
  });
});
