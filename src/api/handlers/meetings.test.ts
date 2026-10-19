import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The world of the factories: Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar
 * (usr_004) is on no team, and usr_005 is the agent of Sara. "Now" is 2026-09-30 09:00 in Riyadh. Nour (usr_006) is a Member who is
 * on no team, and Reem (usr_007) is a Member who left the office.
 */
function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Reem Gone', active: false });
  t.store.state.counters.usr = 7;
  return t;
}

const START = '2026-10-01T10:00:00+03:00';
const project = (extra: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Review the facade', projectId: 'prj_001', startsAt: START, ...extra });
const office = (extra: Record<string, unknown> = {}) => ({ kind: 'meeting' as const, title: 'Meet a new client', startsAt: START, ...extra });

const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, details } = e as { code: string; details: { reason?: string; fields?: string[] } };
    return { code, reason: details.reason, fields: details.fields };
  }
};

describe('meetings.create', () => {
  it('makes a project meeting for a team member, with the organizer as the person for the minutes', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'], where: 'Site office', guests: 'The owner', notes: 'Bring the plans' }));
    expect(made).toMatchObject({
      id: 'mtg_001', kind: 'client', title: 'Review the facade', status: 'scheduled', rev: 1, where: 'Site office', guests: 'The owner', notes: 'Bring the plans',
      startsAt: '2026-10-01T10:00:00.000+03:00', endsAt: '2026-10-01T11:00:00.000+03:00', attendeeCount: 1, mine: true,
      project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower' }, organizer: { id: 'usr_003' },
      minutesBy: { id: 'usr_003' }, attendees: [{ id: 'usr_002' }], viewerCan: { edit: true, cancel: true },
      settledAt: null, minutesTask: null, trackerEntry: null,
    });
    expect(t.store.state.meetings!.mtg_001).toMatchObject({
      organizerId: 'usr_003', attendeeIds: ['usr_002'], minutesById: 'usr_003', projectId: 'prj_001', createdBy: 'usr_003', createdAt: '2026-09-30T09:00:00.000+03:00',
    });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.created')!;
    expect(event).toMatchObject({ targetType: 'meeting', targetId: 'mtg_001', projectId: 'prj_001', before: null });
  });

  it('makes a meeting with no project for a person on no team', async () => {
    const t = world();
    t.as('usr_004');
    const made = await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'] }));
    expect(made).toMatchObject({ id: 'mtg_001', project: null, organizer: { id: 'usr_004' }, attendeeCount: 1 });
    expect(Object.values(t.store.state.events).find((e) => e.verb === 'meeting.created')).toMatchObject({ projectId: null, targetId: 'mtg_001' });
  });

  it('sets the length and the person for the minutes by the kind', async () => {
    const t = world();
    t.as('usr_003');
    const cases = [
      ['meeting', 60, 'usr_003'], ['client', 60, 'usr_003'], ['team', 30, null], ['site_visit', 120, 'usr_003'],
    ] as const;
    for (const [kind, minutes, minutesBy] of cases) {
      const made = await t.api.call('meetings.create', office({ kind, title: `A ${kind}` }));
      expect(Date.parse(made.endsAt) - Date.parse(made.startsAt), kind).toBe(minutes * 60_000);
      expect(made.minutesBy?.id ?? null, kind).toBe(minutesBy);
    }
  });

  it('takes a length, nobody for the minutes, or an attendee for the minutes', async () => {
    const t = world();
    t.as('usr_003');
    const long = await t.api.call('meetings.create', office({ durationMin: 90, attendeeIds: ['usr_004'], minutesById: 'usr_004' }));
    expect(long.endsAt).toBe('2026-10-01T11:30:00.000+03:00');
    expect(long.minutesBy?.id).toBe('usr_004');
    const nobody = await t.api.call('meetings.create', office({ minutesById: null }));
    expect(nobody.minutesBy).toBeNull();
  });

  it('stores every stamp in office time and reads a stamp in UTC', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', office({ startsAt: '2026-10-01T20:30:00Z' }));
    expect(made.startsAt).toBe('2026-10-01T23:30:00.000+03:00');
    expect(made.endsAt).toBe('2026-10-02T00:30:00.000+03:00');
  });

  it('drops the organizer and a repeated person from the attendees', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', office({ attendeeIds: ['usr_003', 'usr_004', 'usr_004', 'usr_002'] }));
    expect(t.store.state.meetings![made.id].attendeeIds).toEqual(['usr_004', 'usr_002']);
  });

  it('lets an agent plan a meeting for its person, who is the organizer', async () => {
    const t = world();
    t.as('usr_005');
    const made = await t.api.call('meetings.create', project());
    expect(made.organizer.id).toBe('usr_003');
    expect(t.store.state.meetings![made.id]).toMatchObject({ organizerId: 'usr_003', createdBy: 'usr_005' });
    expect(Object.values(t.store.state.events).find((e) => e.verb === 'meeting.created')).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003', actorKind: 'agent' });
  });

  it('refuses a start more than 14 days ago, and allows exactly 14 days', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ startsAt: '2026-09-16T08:55:00+03:00' })))).toEqual({ code: 'invalid_input', reason: 'in_the_past', fields: ['startsAt'] });
    const allowed = await t.api.call('meetings.create', office({ startsAt: '2026-09-16T09:00:00+03:00' }));
    expect(allowed.startsAt).toBe('2026-09-16T09:00:00.000+03:00');
  });

  it('refuses a closed project, and allows a project on hold', async () => {
    const t = world();
    t.as('usr_003');
    t.store.state.projects.prj_001.status = 'completed';
    expect(await refusal(() => t.api.call('meetings.create', project()))).toEqual({ code: 'invalid_input', reason: 'project_closed', fields: ['projectId'] });
    t.store.state.projects.prj_001.status = 'archived';
    expect((await refusal(() => t.api.call('meetings.create', project())))?.reason).toBe('project_closed');
    t.store.state.projects.prj_001.status = 'on_hold';
    expect((await t.api.call('meetings.create', project())).project?.id).toBe('prj_001');
  });

  it('refuses a person for the minutes who does not attend', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ minutesById: 'usr_004' })))).toEqual({ code: 'invalid_input', reason: 'minutes_not_attending', fields: ['minutesById'] });
    expect((await t.api.call('meetings.create', office({ attendeeIds: ['usr_004'], minutesById: 'usr_004' }))).minutesBy?.id).toBe('usr_004');
  });

  it('refuses a start that is not on a multiple of 5 minutes', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ startsAt: '2026-10-01T10:03:00+03:00' })))).toEqual({ code: 'invalid_input', reason: 'start_not_on_five', fields: ['startsAt'] });
    expect((await refusal(() => t.api.call('meetings.create', office({ startsAt: '2026-10-01T10:00:30+03:00' }))))?.reason).toBe('start_not_on_five');
  });

  it('refuses 31 people, a length out of range, an empty title and a hidden character in the title', async () => {
    const t = world();
    t.as('usr_003');
    const many = Array.from({ length: 31 }, (_, i) => `usr_${String(100 + i)}`);
    expect((await refusal(() => t.api.call('meetings.create', office({ attendeeIds: many }))))?.code).toBe('invalid_input');
    expect((await refusal(() => t.api.call('meetings.create', office({ durationMin: 14 }))))?.code).toBe('invalid_input');
    expect((await refusal(() => t.api.call('meetings.create', office({ durationMin: 721 }))))?.code).toBe('invalid_input');
    expect((await refusal(() => t.api.call('meetings.create', office({ title: '   ' }))))?.code).toBe('invalid_input');
    expect(await refusal(() => t.api.call('meetings.create', office({ title: `Call⁩ Omar` })))).toEqual({ code: 'invalid_input', reason: 'title_hidden', fields: ['title'] });
    expect(Object.keys(t.store.state.meetings ?? {})).toEqual([]);
  });

  it('refuses an attendee who left, an agent, and a person who does not exist', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ attendeeIds: ['usr_007'] })))).toEqual({ code: 'invalid_input', reason: 'person_inactive', fields: ['attendeeIds'] });
    expect(await refusal(() => t.api.call('meetings.create', office({ attendeeIds: ['usr_005'] })))).toEqual({ code: 'invalid_input', reason: 'attendee_agent', fields: ['attendeeIds'] });
    expect((await refusal(() => t.api.call('meetings.create', office({ attendeeIds: ['usr_099'] }))))?.code).toBe('not_found');
  });

  it('needs the right to post for a project meeting', async () => {
    const t = world();
    for (const [person, ok] of [['usr_001', true], ['usr_002', true], ['usr_003', true], ['usr_004', false], ['usr_006', false]] as const) {
      t.as(person);
      const result = await refusal(() => t.api.call('meetings.create', project({ title: `By ${person}` })));
      expect(result === null, person).toBe(ok);
      if (!ok) expect(result, person).toMatchObject({ code: 'forbidden' });
    }
  });

  it('answers not_found for a project that does not exist', async () => {
    const t = world();
    t.as('usr_003');
    expect((await refusal(() => t.api.call('meetings.create', project({ projectId: 'prj_099' }))))?.code).toBe('not_found');
  });
});

describe('meetings.get', () => {
  it('gives the detail with the people cards, and not_found for an unknown id', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002', 'usr_004'] }));
    const got = await t.api.call('meetings.get', { id: made.id });
    expect(got.attendees.map((p) => p.id)).toEqual(['usr_002', 'usr_004']);
    expect(got.organizer).toMatchObject({ id: 'usr_003', name: 'Sara Team' });
    expect((await refusal(() => t.api.call('meetings.get', { id: 'mtg_099' })))?.code).toBe('not_found');
  });

  it('shows a project meeting to everyone, with the rights of each person', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    const can = async (person: string) => {
      t.as(person);
      const got = await t.api.call('meetings.get', { id: made.id });
      return [got.mine, got.viewerCan.edit, got.viewerCan.cancel];
    };
    expect(await can('usr_003')).toEqual([true, true, true]);
    expect(await can('usr_002')).toEqual([false, true, true]);
    expect(await can('usr_001')).toEqual([false, true, true]);
    expect(await can('usr_004')).toEqual([false, false, false]);
  });
});

describe('meetings.update and meetings.cancel', () => {
  it('lets the organizer, the leader and the Admin change a project meeting, and refuses others', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    for (const [person, ok] of [['usr_003', true], ['usr_002', true], ['usr_001', true], ['usr_004', false], ['usr_006', false]] as const) {
      t.as(person);
      const result = await refusal(() => t.api.call('meetings.update', { id: made.id, notes: `By ${person}` }));
      expect(result === null, person).toBe(ok);
      if (!ok) expect(result, person).toMatchObject({ code: 'forbidden' });
    }
    t.as('usr_004');
    expect((await refusal(() => t.api.call('meetings.cancel', { id: made.id })))?.code).toBe('forbidden');
  });

  it('lets only the organizer change a meeting with no project', async () => {
    const t = world();
    t.as('usr_004');
    const made = await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'] }));
    t.as('usr_003');
    expect((await refusal(() => t.api.call('meetings.update', { id: made.id, notes: 'x' })))?.code).toBe('forbidden');
    expect((await refusal(() => t.api.call('meetings.cancel', { id: made.id })))?.code).toBe('forbidden');
    t.as('usr_004');
    expect((await t.api.call('meetings.update', { id: made.id, notes: 'Mine' })).notes).toBe('Mine');
  });

  it('raises rev for a change of the day, the time, the length or the place, and for a cancel, and not for a title or notes', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    const rev = async () => t.store.state.meetings![made.id].rev;
    expect(await rev()).toBe(1);
    await t.api.call('meetings.update', { id: made.id, title: 'New title', notes: 'Note', guests: 'A guest' });
    expect(await rev()).toBe(1);
    await t.api.call('meetings.update', { id: made.id, where: 'Room 2' });
    expect(await rev()).toBe(2);
    await t.api.call('meetings.update', { id: made.id, startsAt: '2026-10-02T11:00:00+03:00' });
    expect(t.store.state.meetings![made.id]).toMatchObject({ startsAt: '2026-10-02T11:00:00.000+03:00', endsAt: '2026-10-02T12:00:00.000+03:00', rev: 3 });
    await t.api.call('meetings.update', { id: made.id, durationMin: 30 });
    expect(t.store.state.meetings![made.id]).toMatchObject({ endsAt: '2026-10-02T11:30:00.000+03:00', rev: 4 });
    await t.api.call('meetings.cancel', { id: made.id });
    expect(t.store.state.meetings![made.id]).toMatchObject({ status: 'cancelled', rev: 5 });
  });

  it('writes one event for each change, and none for a call that changes nothing', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ where: 'Room 1' }));
    const verbs = () => Object.values(t.store.state.events).filter((e) => e.targetType === 'meeting').map((e) => e.verb);
    await t.api.call('meetings.update', { id: made.id, where: 'Room 1', title: 'Review the facade' });
    expect(verbs()).toEqual(['meeting.created']);
    await t.api.call('meetings.update', { id: made.id, where: 'Room 2' });
    expect(verbs()).toEqual(['meeting.created', 'meeting.updated']);
    await t.api.call('meetings.cancel', { id: made.id });
    expect(verbs()).toEqual(['meeting.created', 'meeting.updated', 'meeting.cancelled']);
    await t.api.call('meetings.cancel', { id: made.id });
    expect(verbs()).toEqual(['meeting.created', 'meeting.updated', 'meeting.cancelled']);
    const updated = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.updated')!;
    expect(updated).toMatchObject({ projectId: 'prj_001', before: { where: 'Room 1' }, after: { where: 'Room 2' } });
  });

  it('refuses a change of a cancelled meeting', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    await t.api.call('meetings.cancel', { id: made.id });
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, notes: 'x' }))).toMatchObject({ code: 'conflict', reason: 'meeting_cancelled' });
  });

  it('changes only the notes after the end', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    setNow(new Date('2026-10-01T09:00:00Z'));
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, title: 'Late edit' }))).toMatchObject({ code: 'conflict', reason: 'meeting_over' });
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, where: 'Room 9', notes: 'x' }))).toMatchObject({ reason: 'meeting_over' });
    expect(await refusal(() => t.api.call('meetings.cancel', { id: made.id }))).toMatchObject({ code: 'conflict', reason: 'meeting_over' });
    // A call that repeats the stored values and changes the notes passes.
    const edited = await t.api.call('meetings.update', { id: made.id, title: 'Review the facade', notes: 'Minutes in the file' });
    expect(edited.notes).toBe('Minutes in the file');
    expect(t.store.state.meetings![made.id].rev).toBe(1);
  });

  it('keeps the project of a meeting', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, projectId: null }))).toEqual({ code: 'invalid_input', reason: 'project_fixed', fields: ['projectId'] });
    expect((await t.api.call('meetings.update', { id: made.id, projectId: 'prj_001', notes: 'Same project' })).notes).toBe('Same project');
  });

  it('checks the people and the person for the minutes on a change', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', office({ attendeeIds: ['usr_004'], minutesById: 'usr_004' }));
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, attendeeIds: ['usr_002'] }))).toMatchObject({ reason: 'minutes_not_attending' });
    const changed = await t.api.call('meetings.update', { id: made.id, attendeeIds: ['usr_002'], minutesById: null });
    expect(changed.attendees.map((p) => p.id)).toEqual(['usr_002']);
    expect(changed.minutesBy).toBeNull();
  });

  it('refuses a start more than 14 days ago on a change, and checks the multiple of 5', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', office());
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, startsAt: '2026-09-01T10:00:00+03:00' }))).toMatchObject({ reason: 'in_the_past' });
    expect(await refusal(() => t.api.call('meetings.update', { id: made.id, startsAt: '2026-10-01T10:01:00+03:00' }))).toMatchObject({ reason: 'start_not_on_five' });
  });

  it('takes back a create, a change and a cancel with Undo, and raises rev for a change that comes back', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ where: 'Room 1' }));
    await t.api.call('meetings.update', { id: made.id, where: 'Room 2' });
    const changed = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.updated')!;
    await t.api.call('events.undo', { eventId: changed.id });
    expect(t.store.state.meetings![made.id]).toMatchObject({ where: 'Room 1', rev: 3 });
    await t.api.call('meetings.cancel', { id: made.id });
    const cancelled = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.cancelled')!;
    await t.api.call('events.undo', { eventId: cancelled.id });
    expect(t.store.state.meetings![made.id]).toMatchObject({ status: 'scheduled', rev: 5 });
    const created = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.created')!;
    await t.api.call('events.undo', { eventId: created.id });
    expect(t.store.state.meetings![made.id]).toBeUndefined();
  });

  it('lets another team member not undo a change that they may not make', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    const created = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.created')!;
    t.as('usr_002');
    // Faisal leads the project but did not make the change: the Undo belongs to its maker and the agents of the maker.
    expect((await refusal(() => t.api.call('events.undo', { eventId: created.id })))?.code).toBe('forbidden');
    expect(t.store.state.meetings![made.id]).toBeDefined();
  });
});

describe('meetings.list', () => {
  /** Sara plans: a project meeting on 2026-10-01 with Faisal, an office meeting on 2026-10-03, and Omar plans one with Nour. */
  async function plans() {
    const t = world();
    t.as('usr_003');
    const a = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'], title: 'A project meeting' }));
    const b = await t.api.call('meetings.create', office({ startsAt: '2026-10-03T09:00:00+03:00', title: 'B office' }));
    t.as('usr_004');
    const c = await t.api.call('meetings.create', office({ startsAt: '2026-10-02T09:00:00+03:00', title: 'C Omar and Nour', attendeeIds: ['usr_006'] }));
    return { t, a, b, c };
  }

  it('lists my meetings by start, then id, from today for 60 days', async () => {
    const { t, a, b } = await plans();
    t.as('usr_003');
    expect((await t.api.call('meetings.list', {})).map((m) => m.id)).toEqual([a.id, b.id]);
    t.as('usr_002');
    expect((await t.api.call('meetings.list', {})).map((m) => m.id)).toEqual([a.id]);
    t.as('usr_001');
    expect(await t.api.call('meetings.list', {})).toEqual([]);
  });

  it('puts two meetings of one start in the order of their ids', async () => {
    const t = world();
    t.as('usr_003');
    const first = await t.api.call('meetings.create', office({ title: 'First' }));
    const second = await t.api.call('meetings.create', office({ title: 'Second' }));
    const early = await t.api.call('meetings.create', office({ title: 'Early', startsAt: '2026-10-01T08:00:00+03:00' }));
    expect((await t.api.call('meetings.list', {})).map((m) => m.id)).toEqual([early.id, first.id, second.id]);
  });

  it('keeps the window by the office day of the start', async () => {
    const { t, a, b } = await plans();
    t.as('usr_003');
    expect((await t.api.call('meetings.list', { from: '2026-10-02' })).map((m) => m.id)).toEqual([b.id]);
    expect((await t.api.call('meetings.list', { to: '2026-10-02' })).map((m) => m.id)).toEqual([a.id]);
    expect((await t.api.call('meetings.list', { from: '2026-10-01', to: '2026-10-01' })).map((m) => m.id)).toEqual([a.id]);
    expect(await t.api.call('meetings.list', { from: '2026-12-01' })).toEqual([]);
    // The default window ends 60 days after today: a meeting on day 61 is outside, and on day 60 inside.
    const inside = await t.api.call('meetings.create', office({ startsAt: '2026-11-29T10:00:00+03:00', title: 'Day 60' }));
    const outside = await t.api.call('meetings.create', office({ startsAt: '2026-11-30T10:00:00+03:00', title: 'Day 61' }));
    const ids = (await t.api.call('meetings.list', {})).map((m) => m.id);
    expect(ids).toContain(inside.id);
    expect(ids).not.toContain(outside.id);
  });

  it('puts a meeting at 23:30 Riyadh on its own day', async () => {
    const t = world();
    t.as('usr_003');
    const late = await t.api.call('meetings.create', office({ startsAt: '2026-10-01T23:30:00+03:00' }));
    expect((await t.api.call('meetings.list', { from: '2026-10-01', to: '2026-10-01' })).map((m) => m.id)).toEqual([late.id]);
    expect(await t.api.call('meetings.list', { from: '2026-10-02', to: '2026-10-02' })).toEqual([]);
  });

  it('refuses a window over 400 days, a window that ends before it starts, and "not mine" without a project', async () => {
    const { t } = await plans();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.list', { from: '2026-10-01', to: '2027-11-05' }))).toMatchObject({ code: 'invalid_input', reason: 'window_too_long' });
    expect((await t.api.call('meetings.list', { from: '2026-10-01', to: '2027-11-04' })).length).toBeGreaterThanOrEqual(0);
    expect(await refusal(() => t.api.call('meetings.list', { from: '2026-10-05', to: '2026-10-01' }))).toMatchObject({ reason: 'window_reversed' });
    expect(await refusal(() => t.api.call('meetings.list', { mine: false }))).toMatchObject({ code: 'invalid_input', reason: 'project_needed' });
  });

  it('filters by project, and "not mine" lists every meeting of that project for anyone', async () => {
    const { t, a } = await plans();
    t.as('usr_003');
    expect((await t.api.call('meetings.list', { projectId: 'prj_001' })).map((m) => m.id)).toEqual([a.id]);
    t.as('usr_004');
    expect(await t.api.call('meetings.list', { projectId: 'prj_001' })).toEqual([]);
    expect((await t.api.call('meetings.list', { projectId: 'prj_001', mine: false })).map((m) => m.id)).toEqual([a.id]);
    expect((await refusal(() => t.api.call('meetings.list', { projectId: 'prj_099' })))?.code).toBe('not_found');
  });

  it('shows a cancelled meeting with its status, and counts the attendees', async () => {
    const { t, a } = await plans();
    t.as('usr_003');
    await t.api.call('meetings.cancel', { id: a.id });
    const row = (await t.api.call('meetings.list', {})).find((m) => m.id === a.id)!;
    expect(row).toMatchObject({ status: 'cancelled', attendeeCount: 1, mine: true, project: { id: 'prj_001' }, organizer: { id: 'usr_003' } });
  });

  it('gives at most 200 rows, the earliest first', async () => {
    const t = world();
    t.as('usr_003');
    const state = t.store.state;
    state.meetings = {};
    for (let i = 1; i <= 205; i += 1) {
      const id = `mtg_${String(i).padStart(3, '0')}`;
      const minute = 5 * (i % 12);
      state.meetings[id] = {
        id, kind: 'meeting', title: `Meeting ${i}`, projectId: null, startsAt: `2026-10-02T10:${String(minute).padStart(2, '0')}:00.000+03:00`,
        endsAt: `2026-10-02T11:${String(minute).padStart(2, '0')}:00.000+03:00`, where: '', guests: '', notes: '', organizerId: 'usr_003', attendeeIds: [],
        minutesById: null, status: 'scheduled', rev: 1, createdBy: 'usr_003', createdAt: '2026-09-30T09:00:00.000+03:00',
      };
    }
    state.counters.mtg = 205;
    const rows = await t.api.call('meetings.list', {});
    expect(rows).toHaveLength(200);
    const starts = rows.map((r) => Date.parse(r.startsAt));
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
    // The 5 rows cut are the latest: the starts of 10:55 sort after every start of 10:00 to 10:50.
    expect(rows.at(-1)!.startsAt).toBe('2026-10-02T10:55:00.000+03:00');
  });
});

describe('meetings and the rest of the office', () => {
  it('takes the meetings of a project and their notices with it when the project is deleted', async () => {
    const t = world();
    t.as('usr_003');
    const inProject = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    const alone = await t.api.call('meetings.create', office({ attendeeIds: ['usr_004'] }));
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(Object.keys(t.store.state.meetings ?? {})).toEqual([alone.id]);
    expect(inProject.id).not.toBe(alone.id);
  });

  it('is not found by search, whoever asks', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ title: 'Zebra facade review' }));
    await t.api.call('meetings.create', office({ title: 'Zebra new client', attendeeIds: ['usr_004'] }));
    for (const person of ['usr_001', 'usr_002', 'usr_003', 'usr_004']) {
      t.as(person);
      expect(JSON.stringify(await t.api.call('search.query', { text: 'zebra' })), person).not.toContain('Zebra');
    }
  });
});
