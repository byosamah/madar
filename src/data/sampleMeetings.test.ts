import { describe, expect, it } from 'vitest';
import { Meeting } from '../api/contract/entities';
import { calls } from '../api/calls';
import { memoryPersister } from '../api/persist';
import { meetingsOf, Store } from '../api/store';
import { createApi } from '../api/client';
import { bootstrap } from '../app/bootstrap';
import { addDays, setNow } from '../lib/dates';
import { dayOf } from '../lib/meetings';
import { isWorkingDay } from '../lib/workdays';
import { NOW, TODAY } from '../test/factories';
import { addSampleMeetings } from './sampleMeetings';
import { sampleOffice } from './sampleOffice';
import { buildSeed } from './seed';
import { shiftState } from './shift';

describe('the sample meetings (fbk_022)', () => {
  it('makes a client meeting of an open project and a private meeting with no project, both valid records', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    expect(Object.keys(meetingsOf(state))).toEqual([]);
    addSampleMeetings(state, TODAY);
    const [project, office] = Object.values(meetingsOf(state));
    for (const meeting of [project, office]) expect(Meeting.safeParse(meeting).success, meeting.id).toBe(true);
    expect(project).toMatchObject({ id: 'mtg_001', kind: 'client', status: 'scheduled', rev: 1 });
    expect(state.projects[project.projectId!].status).toBe('active');
    expect(project.organizerId).toBe(state.projects[project.projectId!].leaderId);
    expect(office).toMatchObject({ id: 'mtg_002', kind: 'meeting', projectId: null });
    expect(state.users[office.organizerId].systemRole).toBe('admin');
  });

  it('puts both meetings on working days after today, with no clash of the day', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    addSampleMeetings(state, TODAY);
    const days = Object.values(meetingsOf(state)).map((meeting) => dayOf(meeting));
    for (const day of days) {
      expect(day > TODAY).toBe(true);
      expect(isWorkingDay(day)).toBe(true);
    }
    expect(days[1] > days[0]).toBe(true);
  });

  it('is in the prototype office on its first start and after a reset, and the plain seed stays without it', async () => {
    setNow(NOW);
    const first = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    expect(Object.keys(meetingsOf(first.store.state))).toHaveLength(2);
    await first.api.call('session.resetSampleData', {});
    expect(Object.keys(meetingsOf(first.store.state))).toHaveLength(2);
    setNow(null);
  });

  it('reads through meetings.list for the people of the meeting only', async () => {
    setNow(NOW);
    const state = await sampleOffice(NOW, async () => undefined);
    const store = new Store(state, memoryPersister());
    const api = createApi(calls, { store, latencyMs: 0, sampleOffice });
    const office = Object.values(meetingsOf(state)).find((meeting) => meeting.projectId === null)!;
    const outsider = Object.values(state.users).find((user) => user.kind === 'human' && user.systemRole === 'member' && !office.attendeeIds.includes(user.id))!;
    store.state.session.currentUserId = outsider.id;
    const rows = await api.call('meetings.list', { from: TODAY, to: addDays(TODAY, 30) });
    expect(rows.every((row) => row.id !== office.id)).toBe(true);
    store.state.session.currentUserId = office.organizerId;
    expect((await api.call('meetings.list', { from: TODAY, to: addDays(TODAY, 30) })).some((row) => row.id === office.id)).toBe(true);
    setNow(null);
  });

  it('moves with the days of a shift, and never sits in the past because of settleFuture', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    addSampleMeetings(state, TODAY);
    const before = Object.values(meetingsOf(state)).map((meeting) => [meeting.startsAt, meeting.endsAt]);
    const shifted = shiftState(state, 3);
    const after = Object.values(meetingsOf(shifted)).map((meeting) => [meeting.startsAt, meeting.endsAt]);
    expect(after.map(([start]) => dayOf({ startsAt: start }))).toEqual(before.map(([start]) => addDays(dayOf({ startsAt: start }), 3)));
    expect(after.map(([, end]) => end.slice(11))).toEqual(before.map(([, end]) => end.slice(11)));
  });
});
