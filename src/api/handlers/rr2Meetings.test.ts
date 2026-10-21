import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { memberKey } from '../rowKeys';
import { setNow } from '../../lib/dates';
import { makeUser, NOW, testApi } from '../../test/factories';
import { both, without as off, withExtra as extra } from '../../test/rr2work';

beforeEach(() => setNow(NOW));

/**
 * The meeting gates of role rights version 2 (design 5.3): meeting.plan (none, team, all), meeting.editOwn, meeting.any,
 * meeting.minutesOwn, meeting.minutesAny. People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member, usr_004 outside the
 * team, usr_005 agent of usr_003, usr_006 team member who attends nothing.
 */
const START = '2026-10-01T10:00:00+03:00';
const AFTER_END = new Date('2026-10-01T08:30:00Z');
const project = (more: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Review the facade', projectId: 'prj_001', startsAt: START, ...more });
const office = (more: Record<string, unknown> = {}) => ({ kind: 'meeting' as const, title: 'Meet a client', startsAt: START, ...more });

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  const { state } = t.store;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Team' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  state.counters.usr = 6;
  if (roles) state.settings.roles = roles;
  return t;
}

describe('meeting.plan: plan a meeting', () => {
  it('passes for the team with the switch on, and refuses a project meeting with the team switch off', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    const closed = world(off('meeting.plan.team'));
    closed.as('usr_003');
    await expect(closed.api.call('meetings.create', project())).rejects.toMatchObject({ code: 'forbidden' });
    // The meeting with no project asks the none switch, so it stays open.
    await closed.api.call('meetings.create', office());
  });

  it('refuses a meeting with no project with the none switch off, and a project meeting stays open', async () => {
    const t = world(off('meeting.plan.none'));
    t.as('usr_003');
    await expect(t.api.call('meetings.create', office())).rejects.toMatchObject({ code: 'forbidden' });
    await t.api.call('meetings.create', project());
  });

  it('keeps a person outside the team out of a project, and lets the all switch open it', async () => {
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('meetings.create', project())).rejects.toMatchObject({ code: 'forbidden' });
    const all = world(extra('meeting.plan.all'));
    all.as('usr_004');
    await all.api.call('meetings.create', project());
  });

  it('refuses the agent of a person without the switch', async () => {
    const t = world(off('meeting.plan.team'));
    t.as('usr_005');
    await expect(t.api.call('meetings.create', project())).rejects.toMatchObject({ code: 'forbidden' });
    const none = world(off('meeting.plan.none'));
    none.as('usr_005');
    await expect(none.api.call('meetings.create', office())).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('tells the screen through planMeeting', async () => {
    const t = world(off('meeting.plan.team'));
    t.as('usr_003');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.planMeeting).toBe(false);
  });
});

describe('meeting.editOwn and meeting.any: change, cancel, delete and extend', () => {
  async function made(roles?: RoleSettings, by = 'usr_003') {
    const t = world();
    t.as(by);
    const meeting = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'], repeat: { every: 'week', until: '2026-12-31' } }));
    if (roles) t.store.state.settings.roles = roles;
    return { t, id: meeting.id, seriesId: meeting.seriesId! };
  }

  it('lets the organizer change, cancel, delete and extend with the switch on', async () => {
    const { t, id, seriesId } = await made();
    await t.api.call('meetings.update', { id, title: 'New title' });
    await t.api.call('meetings.extend', { seriesId });
    await t.api.call('meetings.cancel', { id });
    await t.api.call('meetings.delete', { id });
  });

  it('refuses the organizer with the switch off, for each of the four calls', async () => {
    const { t, id, seriesId } = await made(off('meeting.editOwn'));
    await expect(t.api.call('meetings.update', { id, title: 'New title' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('meetings.cancel', { id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('meetings.extend', { seriesId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('meetings.delete', { id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('meetings.update', { id, title: 'By agent' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a team member who did not organize the meeting', async () => {
    const { t, id } = await made();
    t.as('usr_006');
    await expect(t.api.call('meetings.update', { id, title: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader change any project meeting with the lead switch, and refuses with it off', async () => {
    const { t, id } = await made(off('meeting.editOwn'));
    t.as('usr_002');
    await t.api.call('meetings.update', { id, title: 'By the leader' });
    const closed = await made(off('meeting.any.lead', 'meeting.editOwn'));
    closed.t.as('usr_002');
    await expect(closed.t.api.call('meetings.update', { id: closed.id, title: 'By the leader' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the all switch change a meeting of a project the person is not on', async () => {
    const { t, id } = await made(both([], ['meeting.any.all']));
    t.as('usr_004');
    await t.api.call('meetings.update', { id, title: 'By outside' });
  });

  it('keeps a meeting with no project with its organizer only: the any switch does not reach it', async () => {
    const t = world(both([], ['meeting.any.all']));
    t.as('usr_003');
    const solo = await t.api.call('meetings.create', office({ attendeeIds: ['usr_006'] }));
    t.as('usr_001');
    await expect(t.api.call('meetings.update', { id: solo.id, title: 'Admin' })).rejects.toMatchObject({ code: 'not_found' });
    t.as('usr_006');
    await expect(t.api.call('meetings.update', { id: solo.id, title: 'Attendee' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('meetings.update', { id: solo.id, title: 'Organizer' });
  });

  it('tells the screen with viewerCan', async () => {
    const { t, id } = await made(off('meeting.editOwn'));
    expect((await t.api.call('meetings.get', { id })).viewerCan).toMatchObject({ edit: false, cancel: false });
  });
});

describe('meeting.minutesOwn and meeting.minutesAny: the minutes and the files of a meeting', () => {
  async function ended(roles?: RoleSettings) {
    const t = world();
    t.as('usr_003');
    const client = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    const solo = await t.api.call('meetings.create', office({ attendeeIds: ['usr_004'] }));
    if (roles) t.store.state.settings.roles = roles;
    setNow(AFTER_END);
    return { t, client: client.id, solo: solo.id };
  }
  const minutes = (id: string) => ({ id, text: 'We agreed.', fileIds: [] });

  it('lets an attendee write them with the switch on, and refuses with it off', async () => {
    const on = await ended();
    on.t.as('usr_004');
    await on.t.api.call('meetings.saveMinutes', minutes(on.client));
    const closed = await ended(off('meeting.minutesOwn'));
    closed.t.as('usr_004');
    await expect(closed.t.api.call('meetings.saveMinutes', minutes(closed.client))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(closed.t.api.call('meetings.saveMinutes', minutes(closed.solo))).rejects.toMatchObject({ code: 'forbidden' });
    closed.t.as('usr_005');
    await expect(closed.t.api.call('meetings.saveMinutes', minutes(closed.client))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a team member who attends nothing, and lets the leader write through the lead switch', async () => {
    const w = await ended();
    w.t.as('usr_006');
    await expect(w.t.api.call('meetings.saveMinutes', minutes(w.client))).rejects.toMatchObject({ code: 'forbidden' });
    w.t.as('usr_002');
    await w.t.api.call('meetings.saveMinutes', minutes(w.client));
  });

  it('refuses the leader with the lead switch off', async () => {
    const w = await ended(off('meeting.minutesAny.lead'));
    w.t.as('usr_002');
    await expect(w.t.api.call('meetings.saveMinutes', minutes(w.client))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the all switch write the minutes of a project meeting for a person outside the team who attends nothing', async () => {
    const w = await ended(both([], ['meeting.minutesAny.all']));
    w.t.as('usr_001');
    await w.t.api.call('meetings.saveMinutes', minutes(w.client));
  });

  it('asks the same for the file of a meeting with no project', async () => {
    const w = await ended();
    w.t.as('usr_004');
    const detail = await w.t.api.call('meetings.get', { id: w.solo });
    expect(detail.viewerCan.minutes).toBe(true);
    await w.t.api.call('files.upload', { meetingId: w.solo, name: 'notes.pdf', blob: new Blob(['x'], { type: 'application/pdf' }) });
    w.t.store.state.settings.roles = off('meeting.minutesOwn');
    expect((await w.t.api.call('meetings.get', { id: w.solo })).viewerCan.minutes).toBe(false);
    await expect(w.t.api.call('files.upload', { meetingId: w.solo, name: 'more.pdf', blob: new Blob(['x'], { type: 'application/pdf' }) })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
